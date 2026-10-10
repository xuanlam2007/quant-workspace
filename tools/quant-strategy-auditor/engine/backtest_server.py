import asyncio
import json
import os
from typing import Literal
from uuid import uuid4
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

from .backtest_bridge import register_backtest
from .cli_analyzer import CliLearningAnalyzer, observer_settings, find_cli
from .account_terminal import AccountTerminal
from .ai_request_terminal import AiRequestTerminal
from .request_security import StrictRequest, empty_body, install_request_security

STRATEGY_FOLDER = Path(__file__).resolve().parents[3] / "private" / "backtest" / "strategies"


class BacktestAiConfig(StrictRequest):
    provider: Literal["CODEX", "AGY"]
    model: str = Field(default="", max_length=120, pattern=r"^[^\x00-\x1f]*$")
    effort: str = Field(default="", max_length=40, pattern=r"^(?:[a-z][a-z0-9_-]*)?$")


class BacktestTerminal(StrictRequest):
    provider: Literal["CODEX", "AGY"]


class BacktestStrategy(StrictRequest):
    content: str = Field(min_length=1, max_length=100000)


def create_app(config_path="config.json", preferences_path=None):
    config_path = os.path.abspath(config_path)
    config = json.loads(Path(config_path).read_text(encoding="utf-8-sig")) if Path(config_path).is_file() else {}
    preferences_path = Path(preferences_path) if preferences_path else STRATEGY_FOLDER.parent / "config.json"
    if preferences_path.is_file():
        preferences = json.loads(preferences_path.read_text(encoding="utf-8-sig"))
        config.update({key: preferences[key] for key in ("backtest_ai_connection", "backtest_strategy_documents") if key in preferences})
    # Chỉ đọc cấu hình riêng; không tạo recorder, session hoặc worker của Auditor.
    saved = config.get("backtest_ai_connection", config.get("ai_connection", {})) or {}
    settings = saved if saved.get("provider") in ("CODEX", "AGY") else {"provider": "CODEX"}
    analyzer = CliLearningAnalyzer(settings)
    analyzer.terminal = AiRequestTerminal("backtest", config.get("terminal_type", "ORCA"))
    app = FastAPI(title="Quant Backtest Engine")
    install_request_security(app)
    app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("BACKTEST_UI_URL", "http://localhost:3000")], allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?", allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    register_backtest(app, analyzer, config, config_path)
    checking = asyncio.Lock()
    account_terminal = AccountTerminal("backtest", config.get("terminal_type", "ORCA"))

    def save_preference(key, value):
        # Lưu riêng để tiến trình Auditor không ghi đè preferences của Backtest.
        target = preferences_path
        temporary = target.with_name(target.name + "." + uuid4().hex + ".tmp")
        try:
            latest = json.loads(target.read_text(encoding="utf-8-sig")) if target.is_file() else {}
            latest[key] = value
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(target)
            config[key] = value
        except (OSError, ValueError):
            raise HTTPException(500, "Không lưu được cấu hình Backtest.") from None
        finally:
            temporary.unlink(missing_ok=True)

    @app.get("/api/ai/catalog")
    async def catalog(provider: Literal["CODEX", "AGY"], refresh: bool = False):
        return await asyncio.to_thread(analyzer.catalog, provider, refresh)

    @app.post("/api/backtest/connection/config")
    async def configure(payload: BacktestAiConfig):
        settings = observer_settings(payload.model_dump())
        if settings["model"].startswith("-"):
            raise HTTPException(400, "Tên model không được là CLI option.")
        if settings["model"] or settings["effort"]:
            choices = await asyncio.to_thread(analyzer.catalog, settings["provider"])
            selected = next((item for item in choices["models"] if item["id"] == settings["model"]), None) if settings["model"] else next((item for item in choices["models"] if item.get("is_default")), None)
            if settings["model"] and not selected:
                raise HTTPException(409, "Model không có trong CLI catalog. Làm mới danh sách.")
            if settings["effort"] and not any(item["id"] == settings["effort"] for item in (selected or {}).get("efforts", [])):
                raise HTTPException(409, "Effort không được model hỗ trợ.")
        if not analyzer._lock.acquire(blocking=False):
            raise HTTPException(409, "AI đang xử lý. Chờ hoàn tất trước khi đổi cấu hình.")
        try:
            save_preference("backtest_ai_connection", settings)
            analyzer.configure(settings)
            return analyzer.status()
        finally:
            analyzer._lock.release()

    @app.post("/api/backtest/strategy")
    async def import_strategy(payload: BacktestStrategy):
        content = payload.content.strip()
        if not content or len(content.encode("utf-8")) > 100000:
            raise HTTPException(422, "Chiến lược phải có nội dung và không vượt 100 KB.")
        if not analyzer._lock.acquire(blocking=False):
            raise HTTPException(409, "AI đang xử lý. Chờ hoàn tất trước khi đổi chiến lược.")
        folder = STRATEGY_FOLDER
        document = folder / (uuid4().hex + ".md")
        try:
            folder.mkdir(parents=True, exist_ok=True)
            document.write_text(content, encoding="utf-8")
            save_preference("backtest_strategy_documents", [os.path.relpath(document, Path(config_path).parent)])
            return {"strategy_available": True}
        except (OSError, HTTPException):
            document.unlink(missing_ok=True)
            raise HTTPException(500, "Không lưu được chiến lược Backtest.") from None
        finally:
            analyzer._lock.release()

    @app.post("/api/backtest/terminal/open")
    async def open_terminal(payload: BacktestTerminal):
        if not analyzer._lock.acquire(blocking=False):
            raise HTTPException(409, "AI đang xử lý. Chờ hoàn tất trước khi mở Terminal đăng nhập.")
        try:
            executable = find_cli(payload.provider)
            if not executable:
                raise HTTPException(503, f"{payload.provider} CLI was not found")
            # Account có thể đổi trong Terminal; bắt buộc kiểm tra lại connection.
            analyzer.invalidate()
            return await asyncio.to_thread(account_terminal.open, payload.provider, executable)
        finally:
            analyzer._lock.release()

    @app.get("/api/health")
    def health():
        return {"engine": "backtest", "protocol_version": 1}

    @app.post("/api/backtest/connection/test", dependencies=[Depends(empty_body)])
    async def test_connection():
        if checking.locked() or analyzer._lock.locked():
            raise HTTPException(409, "Backtest AI đang xử lý. Chờ hoàn tất rồi thử lại.")
        async with checking:
            return await asyncio.to_thread(analyzer.test_connection)

    return app
