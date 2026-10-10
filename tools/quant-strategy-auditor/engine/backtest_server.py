import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware

from .backtest_bridge import register_backtest
from .cli_analyzer import CliLearningAnalyzer
from .request_security import empty_body, install_request_security


def create_app(config_path="config.json"):
    config_path = os.path.abspath(config_path)
    config = json.loads(Path(config_path).read_text(encoding="utf-8-sig")) if Path(config_path).is_file() else {}
    # Chỉ đọc cấu hình riêng; không tạo recorder, session hoặc worker của Auditor.
    saved = config.get("backtest_ai_connection", config.get("ai_connection", {})) or {}
    settings = saved if saved.get("provider") == "CODEX" else {"provider": "CODEX"}
    analyzer = CliLearningAnalyzer(settings)
    app = FastAPI(title="Quant Backtest Engine")
    install_request_security(app)
    app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("BACKTEST_UI_URL", "http://localhost:3000")], allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?", allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    register_backtest(app, analyzer, config, config_path)
    checking = asyncio.Lock()

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
