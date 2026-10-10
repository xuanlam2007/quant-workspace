import os
import sys
import json
import asyncio
import base64
import shutil
import copy
import subprocess
import time
import re
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field, ValidationError
from .request_security import StrictRequest, empty_body, install_request_security, workspace_origin
from .core import TradePairManager, SessionLogger
from .cli_analyzer import CliLearningAnalyzer, find_cli, observer_settings
from .ai_request_terminal import AiRequestTerminal
from .learning_context import load_strategy_documents
from .observed_trades import FillReviewPayload, auto_record_candidates, identify_candidates, recorded_trades
from .desktop_listener import DesktopListener, list_windows, window_details


class TerminalConfigPayload(StrictRequest):
    terminal_type: Literal["ORCA", "WINDOWS", "WT", "NONE"]


class TerminalPayload(StrictRequest):
    terminal_type: Optional[Literal["ORCA", "WINDOWS", "WT", "NONE"]] = None
    purpose: Literal["monitor", "account"] = "monitor"
    provider: Optional[Literal["AGY", "CODEX"]] = None


class AiConfigPayload(StrictRequest):
    provider: Literal["AGY", "CODEX"]
    model: str = Field(default="", max_length=120, pattern=r"^[^\x00-\x1f]*$")
    effort: str = Field(default="", max_length=40, pattern=r"^(?:[a-z][a-z0-9_-]*)?$")


class DrawingPointPayload(StrictRequest):
    timestamp: int = Field(ge=0)
    price: float = Field(gt=0, allow_inf_nan=False)


class DrawingDataPayload(StrictRequest):
    tool: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z][a-zA-Z0-9]*$")
    points: list[DrawingPointPayload] = Field(min_length=1, max_length=20)
    label: str = Field(default="", max_length=500)


class DrawingEventPayload(StrictRequest):
    type: Literal["DRAWING"]
    source_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    drawing_data: DrawingDataPayload


class SocketTicketPayload(StrictRequest):
    client_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")


class TradeEventPayload(StrictRequest):
    type: Literal["TRADE_MANUAL", "TRADE_OPEN", "TRADE_CLOSE"] = "TRADE_MANUAL"
    action: Literal["BUY", "SELL"]
    price: float = Field(gt=0, allow_inf_nan=False)
    contracts: int = Field(default=1, ge=1, le=1000)
    voice_transcript: str = Field(default="", max_length=10000)
    drawing_data: Optional[DrawingDataPayload] = None
    frame_base64: Optional[str] = Field(default=None, max_length=28 * 1024 * 1024)
    session_id: Optional[str] = Field(default=None, max_length=80, pattern=r"^session_\d{6}(?:_\w+)?$")
    session_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    source_id: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_-]*$")


class ObservationPayload(StrictRequest):
    reason: str = Field(default="", max_length=10000)
    frame_base64: Optional[str] = Field(default=None, max_length=28 * 1024 * 1024)
    session_id: Optional[str] = Field(default=None, max_length=80, pattern=r"^session_\d{6}(?:_\w+)?$")
    session_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    source_id: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_-]*$")
    capture_generation: Optional[int] = Field(default=None, ge=0)


class AudioStartPayload(StrictRequest):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    session_id: str = Field(max_length=80, pattern=r"^session_\d{6}(?:_\w+)?$")
    source_id: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_-]*$")
    capture_generation: Optional[int] = Field(default=None, ge=0)


class AudioChunkPayload(StrictRequest):
    data: str = Field(max_length=5 * 1024 * 1024)
    mime: Literal["audio/webm", "audio/ogg", "audio/mp4"]
    started_at: str = Field(max_length=50)
    ended_at: str = Field(max_length=50)
    frame_base64: Optional[str] = Field(default=None, max_length=28 * 1024 * 1024)
    frame_captured_at: Optional[str] = Field(default=None, max_length=50)


class AudioFramePayload(StrictRequest):
    frame_base64: Optional[str] = Field(default=None, max_length=28 * 1024 * 1024)
    captured_at: Optional[str] = Field(default=None, max_length=50)


class ModePayload(StrictRequest):
    mode: Literal["DESKTOP", "IN_APP"]
    target_window_id: int = Field(default=0, ge=0)
    browser_source_id: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_-]*$")


class RecordingPayload(StrictRequest):
    action: Literal["start", "pause", "resume", "stop"]
    source_id: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_-]*$")
    browser_only: bool = False
    capture_generation: Optional[int] = Field(default=None, ge=0)


class RecordingPreference(StrictRequest):
    auto_start: bool


class StrategyModePayload(StrictRequest):
    enabled: bool


class SwitchSessionPayload(StrictRequest):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    session_id: str = Field(max_length=80, pattern=r"^session_\d{6}(?:_\w+)?$")


def create_app(config_path: str = "config.json") -> FastAPI:
    config_path = os.path.abspath(config_path)
    config = {}
    if os.path.isfile(config_path):
        with open(config_path, encoding="utf-8-sig") as file:
            config = json.load(file)
    config.pop("gemini_api_key", None)
    # Tab ghi nhận chỉ dùng tài liệu chiến lược, không dùng quy tắc kiểm tra cũ.
    config.pop("strategy_notes", None)
    config.pop("strategy_configured", None)
    config.pop("hotkeys", None)
    config["strategy_guardrails"] = {key: value for key, value in config.get("strategy_guardrails", {}).items() if key == "fee_per_closed_pair"}
    strategy_documents, strategy_errors = load_strategy_documents(config, config_path)
    config["strategy_mode"] = bool(config.get("strategy_mode", False) and strategy_documents and not strategy_errors)
    app = FastAPI(title="Quant Strategy Auditor Bridge")
    install_request_security(app)
    app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("AUDITOR_UI_URL", "http://localhost:3000")], allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?", allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])
    guardrails = config.get("strategy_guardrails", {})
    pair_manager = TradePairManager(fee_per_pair=guardrails.get("fee_per_closed_pair", 0.45))
    logger = SessionLogger(os.path.join(os.path.dirname(config_path), config.get("storage", {}).get("sessions_dir", "sessions")))
    analyzer = CliLearningAnalyzer(config.get("ai_connection"))
    analyzer.terminal = AiRequestTerminal("auditor", config.get("terminal_type", "ORCA"))
    state = {"mode": config.get("mode", "DESKTOP"), "target_window_title": "", "target_window_id": 0, "browser_source_id": "", "strategy_mode": config["strategy_mode"], "recording_status": "stopped", "recording_error": "", "auto_start_recording": config.get("auto_start_recording", True), "capture_generation": 0}
    clients = []
    main_loop = None
    source_monitor = None
    pending_analysis = set()
    queued_sessions = set()
    analysis_worker = None
    audio_tokens = {}
    strategy_revision = 0
    strategy_changed = False

    def refresh_strategy():
        nonlocal strategy_documents, strategy_errors, strategy_revision, strategy_changed
        documents, errors = load_strategy_documents(config, config_path)
        if documents != strategy_documents or errors != strategy_errors:
            strategy_documents, strategy_errors = documents, errors
            strategy_revision += 1
            strategy_changed = True
        if state["strategy_mode"] and (not documents or errors):
            state["strategy_mode"] = config["strategy_mode"] = False
            strategy_revision += 1
            strategy_changed = True

    def strategy_message():
        return {"type": "STRATEGY_MODE_CHANGED", "enabled": state["strategy_mode"], "strategy_available": bool(strategy_documents and not strategy_errors), "strategy_documents": [doc["name"] for doc in strategy_documents], "strategy_error": "; ".join(strategy_errors)}

    def replay_session():
        pair_manager.reset()
        for event in logger.events:
            queued = event.get("ai_status") == "queued" and (logger.current_date, logger.session_id) in queued_sessions
            if event.get("ai_pending") and event["id"] not in pending_analysis and not queued:
                logger.update_event(event["id"], {"ai_pending": False, "ai_status": "failed", "ai_error": "Analysis was interrupted by an engine restart."})
        for trade in recorded_trades(logger.events):
            action = trade.get("action", "").upper()
            price = float(trade.get("price") or 0)
            if action in ("BUY", "SELL") and price > 0:
                pair_manager.register_trade(action, price, trade.get("timestamp", ""), int(trade.get("contracts", 1)))

    replay_session()

    def snapshot():
        refresh_strategy()
        public_config = {"terminal_type": config.get("terminal_type", "ORCA"), "strategy_guardrails": {"fee_per_closed_pair": guardrails.get("fee_per_closed_pair", 0.45)}}
        return {**state, "protocol_version": 3, "strategy_available": bool(strategy_documents and not strategy_errors), "strategy_documents": [doc["name"] for doc in strategy_documents], "strategy_error": "; ".join(strategy_errors), "current_date": logger.current_date, "date": logger.current_date, "session_id": logger.session_id, "is_recording": state["recording_status"] == "recording", "summary": pair_manager.get_summary(), "recent_events": logger.events[-200:], "gemini_status": analyzer.status(), "config": public_config}

    def strategy_context():
        refresh_strategy()
        return {"enabled": state["strategy_mode"], "documents": copy.deepcopy(strategy_documents) if state["strategy_mode"] else []}

    async def broadcast(message):
        message.setdefault("date", logger.current_date)
        message.setdefault("session_id", logger.session_id)
        for client in list(clients):
            try:
                await client.send_json(message)
            except Exception:
                if client in clients:
                    clients.remove(client)

    def save_config():
        temporary_path = f"{config_path}.{uuid4().hex}.tmp"
        try:
            # Thay thế nguyên tử để lỗi ghi không làm mất cấu hình đã lưu.
            with open(temporary_path, "w", encoding="utf-8") as file:
                json.dump(config, file, indent=2, ensure_ascii=False)
            os.replace(temporary_path, config_path)
        except OSError as error:
            raise HTTPException(500, "Cannot save preference. Check Terminal.") from error
        finally:
            try:
                os.remove(temporary_path)
            except OSError:
                pass

    def require_session(session_id=None, session_date=None):
        if not logger.session_id:
            raise HTTPException(409, "Create or select a session before recording")
        if session_id and (session_id != logger.session_id or session_date != logger.current_date):
            raise HTTPException(409, "The active session changed. Review the current session and try again.")

    def session_path(date, session_id):
        try:
            return logger.session_path(date, session_id)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    def sync_listener():
        if state["mode"] == "DESKTOP" and logger.session_id and state["recording_status"] == "recording":
            listener.target_window_title = state["target_window_title"]
            listener.target_window_id = state["target_window_id"]
            listener.generation = state["capture_generation"]
            listener.start()
        else:
            listener.stop()

    async def desktop_event(event):
        if state["recording_status"] != "recording" or event.get("capture_generation") != state["capture_generation"] or not logger.session_id or event.get("session_id") != logger.session_id or event.get("date") != logger.current_date:
            return
        event["warnings"] = []
        event["strategy"] = strategy_context()
        logger.log_event(event)
        prepare_analysis(event)
        await broadcast({"type": "EVENT_LOGGED", "event": event, "summary": pair_manager.get_summary()})
        if event.get("ai_pending"):
            queue_analysis(event)

    def on_desktop_event(event):
        event.update(date=logger.current_date, session_id=logger.session_id)
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(desktop_event(event), main_loop)

    listener = DesktopListener(state["target_window_title"], on_desktop_event, lambda: logger.frames_dir)

    def stop_recording(status="paused", error=""):
        state.update(recording_status=status, recording_error=error, capture_generation=state["capture_generation"] + 1)
        listener.stop()

    def start_recording(source_id=""):
        require_session()
        if state["mode"] == "DESKTOP":
            details = window_details(state["target_window_id"])
            if not state["target_window_title"] or not details or details["title"] != state["target_window_title"]:
                raise HTTPException(409, "Select an available window before starting recording")
        elif not source_id or source_id != state["browser_source_id"] or not any(ws.query_params.get("client_id") == source_id for ws in clients):
            raise HTTPException(409, "Choose a browser tab or window before starting recording")
        state.update(recording_status="recording", recording_error="", capture_generation=state["capture_generation"] + 1)
        try:
            sync_listener()
        except Exception as error:
            stop_recording(error=str(error))
            raise HTTPException(503, str(error)) from error

    def require_recording(source_id=""):
        require_session()
        if state["recording_status"] != "recording":
            raise HTTPException(409, "Start or resume recording before saving events")
        if state["mode"] == "DESKTOP":
            if not listener.source():
                stop_recording(error="The selected window is unavailable. Select it again to continue.")
                asyncio.create_task(broadcast({"type": "RECORDING_CHANGED", **state}))
                raise HTTPException(409, state["recording_error"])
        elif not source_id or source_id != state["browser_source_id"]:
            raise HTTPException(409, "This browser does not own the selected capture source")

    async def monitor_source():
        next_strategy_scan = 0
        while True:
            await asyncio.sleep(1)
            if time.monotonic() >= next_strategy_scan:
                refresh_strategy()
                next_strategy_scan = time.monotonic() + 5
            if strategy_changed:
                await publish_strategy()
            if state["recording_status"] == "recording" and state["mode"] == "DESKTOP":
                if not listener.source() or listener.last_error:
                    stop_recording(error=listener.last_error or "The selected window is unavailable. Recording is paused.")
                    await broadcast({"type": "RECORDING_CHANGED", **state})

    @app.on_event("startup")
    async def startup():
        nonlocal main_loop, source_monitor
        main_loop = asyncio.get_running_loop()
        source_monitor = asyncio.create_task(monitor_source())

    @app.on_event("shutdown")
    async def shutdown():
        if source_monitor:
            source_monitor.cancel()
        if analysis_worker:
            analysis_worker.cancel()
        listener.stop()

    def open_terminal(terminal_type, purpose="monitor", provider=None):
        if purpose == "monitor":
            require_session()
        term = terminal_type or config.get("terminal_type", "ORCA")
        if term == "NONE":
            if purpose == "account":
                raise HTTPException(409, "Select a Terminal host before managing the AI account")
            return {"status": "disabled", "terminal_type": term}
        script = str(Path(__file__).with_name("session_terminal.py"))
        worktree = str(Path(__file__).resolve().parents[3])
        arguments = [sys.executable, script, "--date", logger.current_date, "--session", logger.session_id]
        command = "& " + " ".join("'" + value.replace("'", "''") + "'" for value in arguments)
        title = f"Auditor [{logger.current_date} {logger.session_id[8:14]}]"
        if purpose == "account":
            selected = provider or analyzer.settings["provider"]
            executable = find_cli(selected)
            if not executable:
                raise HTTPException(503, f"{selected} CLI was not found")
            def cli_command(args):
                return "& " + " ".join("'" + value.replace("'", "''") + "'" for value in [executable, *args])
            command = cli_command([])
            title = f"{selected} Account"
            analyzer.invalidate()
        encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
        try:
            if term == "ORCA":
                executable = shutil.which("orca") or os.path.expandvars(r"%LocalAppData%\Programs\orca\resources\bin\orca.exe")
                if not os.path.isfile(executable):
                    raise RuntimeError("Orca CLI was not found. Open Orca or select another terminal host.")
                result = subprocess.run([executable, "terminal", "create", "--worktree", f"path:{worktree}", "--shell", "powershell.exe", "--title", title, "--command", command, "--focus", "--json"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                if result.returncode != 0:
                    raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Orca exit code {result.returncode}")
                response = json.loads(result.stdout)
                handle = response.get("result", {}).get("terminal", {}).get("handle")
                if not response.get("ok") or not handle:
                    raise RuntimeError(str(response.get("error") or "Orca did not confirm terminal creation"))
                return {"status": "opened", "terminal_type": term, "handle": handle}
            if term == "WT":
                executable = shutil.which("wt")
                if not executable:
                    raise RuntimeError("Windows Terminal was not found")
                process = subprocess.Popen([executable, "new-tab", "--title", title, "powershell.exe", "-NoExit", "-EncodedCommand", encoded], cwd=worktree)
            elif term == "WINDOWS":
                process = subprocess.Popen(["conhost.exe", "powershell.exe", "-NoExit", "-EncodedCommand", encoded], cwd=worktree)
            else:
                raise HTTPException(400, "Unsupported terminal host")
            return {"status": "launched", "terminal_type": term, "pid": process.pid}
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(503, "Terminal launch failed. Check the selected terminal installation.") from error

    @app.get("/api/status")
    def status():
        return snapshot()

    @app.get("/api/windows")
    def windows():
        try:
            return {"windows": list_windows()}
        except Exception as error:
            raise HTTPException(503, str(error)) from error

    @app.post("/api/recording")
    async def recording(payload: RecordingPayload):
        if payload.browser_only and payload.capture_generation != state["capture_generation"]:
            return state
        if payload.browser_only and (state["mode"] != "IN_APP" or payload.source_id != state["browser_source_id"]):
            return state
        if state["mode"] == "IN_APP" and state["browser_source_id"] and payload.source_id != state["browser_source_id"]:
            raise HTTPException(409, "Use the browser that owns the capture source")
        if payload.action in ("pause", "stop"):
            stop_recording("stopped" if payload.action == "stop" else "paused")
        else:
            try:
                start_recording(payload.source_id)
            except HTTPException:
                await broadcast({"type": "RECORDING_CHANGED", **state})
                raise
        await broadcast({"type": "RECORDING_CHANGED", **state})
        return state

    @app.post("/api/recording/preference")
    async def recording_preference(payload: RecordingPreference):
        previous = config.get("auto_start_recording", True)
        config["auto_start_recording"] = payload.auto_start
        try:
            save_config()
        except HTTPException:
            config["auto_start_recording"] = previous
            raise
        state["auto_start_recording"] = payload.auto_start
        await broadcast({"type": "RECORDING_CHANGED", **state})
        return state

    @app.get("/api/gemini/status")
    @app.get("/api/ai/status")
    def ai_status():
        return analyzer.status()

    @app.post("/api/ai/connection/test", dependencies=[Depends(empty_body)])
    async def test_ai_connection():
        result = await asyncio.to_thread(analyzer.test_connection)
        await broadcast({"type": "AI_CONFIG_CHANGED", "ai_status": result})
        if result.get("connected"):
            # Khôi phục riêng lỗi chờ cũ, không tự gửi lại các lỗi model hoặc minh chứng.
            for event in logger.events:
                if "AI is busy" in event.get("ai_error", "") and not event.get("ai_pending"):
                    prepare_analysis(event)
                    queue_analysis(event)
                    await broadcast({"type": "EVENT_UPDATED", "event": event})
        return result

    @app.post("/api/ai/config")
    async def ai_config(payload: AiConfigPayload):
        settings = observer_settings(payload.model_dump())
        if settings["model"].startswith("-"):
            raise HTTPException(400, "Model names cannot start with a CLI option prefix")
        if settings["model"] or settings["effort"]:
            catalog = await asyncio.to_thread(analyzer.catalog, settings["provider"])
            selected = next((item for item in catalog["models"] if item["id"] == settings["model"]), None) if settings["model"] else next((item for item in catalog["models"] if item.get("is_default")), None)
            if settings["model"] and not selected:
                raise HTTPException(409, "The selected model is not in the current CLI catalog. Refresh and select it again.")
            efforts = (selected or {}).get("efforts", [])
            if settings["effort"] and not any(item["id"] == settings["effort"] for item in efforts):
                raise HTTPException(409, "The selected effort is not supported by the CLI for this model. Refresh or use the CLI default.")
        previous = copy.deepcopy(config)
        config["ai_connection"] = settings
        try:
            save_config()
        except HTTPException:
            config.clear()
            config.update(previous)
            raise
        analyzer.configure(settings)
        result = analyzer.status()
        await broadcast({"type": "AI_CONFIG_CHANGED", "ai_status": result})
        return result

    @app.get("/api/ai/catalog")
    async def ai_catalog(provider: Literal["AGY", "CODEX"], refresh: bool = False):
        return await asyncio.to_thread(analyzer.catalog, provider, refresh)

    @app.get("/api/terminal/config")
    def terminal_config():
        return {"terminal_type": config.get("terminal_type", "ORCA"), "supported": ["ORCA", "WINDOWS", "WT", "NONE"]}

    @app.post("/api/terminal/config")
    def set_terminal_config(payload: TerminalConfigPayload):
        previous = config.get("terminal_type", "ORCA")
        config["terminal_type"] = payload.terminal_type or previous
        try:
            save_config()
        except HTTPException:
            config["terminal_type"] = previous
            raise
        analyzer.terminal.host = config["terminal_type"] if config["terminal_type"] in ("ORCA", "WT", "WINDOWS") else "ORCA"
        return terminal_config()

    @app.post("/api/terminal/open")
    async def terminal_open(payload: Optional[TerminalPayload] = None):
        payload = payload or TerminalPayload()
        result = await asyncio.to_thread(open_terminal, payload.terminal_type, payload.purpose, payload.provider)
        if payload.purpose == "account":
            await broadcast({"type": "AI_CONFIG_CHANGED", "ai_status": analyzer.status()})
        return result

    @app.get("/api/sessions")
    def sessions():
        return {"dates": logger.list_all_sessions()}

    async def session_changed():
        stop_recording("stopped")
        replay_session()
        sync_listener()
        result = snapshot()
        await broadcast({"type": "SESSION_SWITCHED", **result})
        return {"status": "ok", **result, "dates": logger.list_all_sessions()}

    @app.post("/api/sessions/new", dependencies=[Depends(empty_body)])
    async def new_session():
        listener.stop()
        logger.new_session()
        return await session_changed()

    @app.post("/api/sessions/switch")
    async def switch_session(payload: SwitchSessionPayload):
        session_path(payload.date, payload.session_id)
        listener.stop()
        if not logger.load_session(payload.date, payload.session_id):
            sync_listener()
            raise HTTPException(404, "Session was not found")
        return await session_changed()

    @app.delete("/api/sessions")
    async def delete_all_sessions():
        listener.stop()
        if not logger.delete_all_sessions():
            sync_listener()
            raise HTTPException(500, "Could not delete sessions")
        return await session_changed()

    @app.delete("/api/sessions/{date}/{session_id}")
    async def delete_session(date: str, session_id: str):
        session_path(date, session_id)
        listener.stop()
        if not logger.delete_session(date, session_id):
            sync_listener()
            raise HTTPException(404, "Session could not be deleted")
        return await session_changed()

    @app.get("/api/sessions/{date}/{session_id}/report/{report_type}")
    def report(date: str, session_id: str, report_type: Literal["html", "pdf"]):
        path = os.path.join(session_path(date, session_id), f"session_review.{report_type}")
        if not os.path.isfile(path):
            raise HTTPException(404, "Report is not available")
        return FileResponse(path, media_type="text/html" if report_type == "html" else "application/pdf")

    @app.get("/api/sessions/{date}/{session_id}/frames/{filename}")
    @app.get("/api/sessions/{date}/{session_id}/report/frames/{filename}")
    def frame(date: str, session_id: str, filename: str):
        if os.path.basename(filename) != filename or not filename.endswith(".png"):
            raise HTTPException(400, "Invalid frame")
        path = os.path.join(session_path(date, session_id), "frames", filename)
        if not os.path.isfile(path):
            raise HTTPException(404, "Frame is not available")
        return FileResponse(path, media_type="image/png")

    @app.get("/api/sessions/{date}/{session_id}/audio/{filename}")
    @app.get("/api/sessions/{date}/{session_id}/report/audio/{filename}")
    def audio_file(date: str, session_id: str, filename: str):
        if os.path.basename(filename) != filename or Path(filename).suffix not in (".webm", ".ogg", ".m4a"):
            raise HTTPException(400, "Invalid audio file")
        path = os.path.join(session_path(date, session_id), "audio", filename)
        if not os.path.isfile(path):
            raise HTTPException(404, "Audio is not available")
        return FileResponse(path, media_type={".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4"}[Path(filename).suffix])

    @app.post("/api/audio/start")
    async def audio_start(payload: AudioStartPayload):
        require_session(payload.session_id, payload.date)
        require_recording(payload.source_id)
        if payload.capture_generation is not None and payload.capture_generation != state["capture_generation"]:
            raise HTTPException(409, "The capture source changed while opening the microphone. Try again.")
        now = time.monotonic()
        for token, record in list(audio_tokens.items()):
            if record["expires"] < now:
                audio_tokens.pop(token, None)
        if len(audio_tokens) >= 16:
            raise HTTPException(429, "Too many active audio recordings")
        token = uuid4().hex
        audio_tokens[token] = {"date": logger.current_date, "session_id": logger.session_id, "expires": now + 120, "strategy": strategy_context(), "generation": state["capture_generation"], "mode": state["mode"], "source_id": payload.source_id, "frames": [], "last_frame": 0}
        return {"token": token}

    @app.post("/api/audio/{token}/frame")
    async def audio_frame(token: str, payload: AudioFramePayload):
        record = audio_tokens.get(token)
        if not record or record["expires"] < time.monotonic():
            raise HTTPException(409, "Audio recording expired")
        require_session(record["session_id"], record["date"])
        require_recording(record["source_id"])
        if record["generation"] != state["capture_generation"] or record["mode"] != state["mode"]:
            raise HTTPException(409, "Capture source changed; no frame was taken")
        if time.monotonic() - record["last_frame"] < 2:
            raise HTTPException(429, "Wait before capturing another observation frame")
        captured_at = datetime.now(timezone.utc)
        if record["mode"] == "IN_APP":
            try:
                captured_at = datetime.fromisoformat((payload.captured_at or "").replace("Z", "+00:00"))
                if captured_at.utcoffset() is None or not -1 <= (datetime.now(timezone.utc) - captured_at).total_seconds() <= 10:
                    raise ValueError("Expected a recent browser frame with a timezone")
            except ValueError as error:
                raise HTTPException(400, str(error)) from error
        path = capture(payload.frame_base64)
        frame = {"path": path, "captured_at": captured_at.isoformat()}
        # Giới hạn bộ đệm, ảnh đã lưu vẫn thuộc phiên và nguồn ghi gốc.
        record["frames"] = [*record["frames"], frame][-24:]
        record["last_frame"] = time.monotonic()
        record["expires"] = time.monotonic() + 120
        return {"frame": frame}

    @app.post("/api/audio/{token}")
    async def audio_chunk(token: str, payload: AudioChunkPayload):
        record = audio_tokens.get(token)
        if not record or record["expires"] < time.monotonic():
            raise HTTPException(409, "Audio recording expired")
        try:
            data = base64.b64decode(payload.data, validate=True)
            valid = (payload.mime == "audio/webm" and data.startswith(b"\x1a\x45\xdf\xa3")) or (payload.mime == "audio/ogg" and data.startswith(b"OggS")) or (payload.mime == "audio/mp4" and data[4:8] == b"ftyp")
            if not valid or len(data) > 3 * 1024 * 1024:
                raise ValueError("Expected a supported audio clip under 3 MB")
            started = datetime.fromisoformat(payload.started_at.replace("Z", "+00:00"))
            ended = datetime.fromisoformat(payload.ended_at.replace("Z", "+00:00"))
            if started.utcoffset() is None or ended.utcoffset() is None:
                raise ValueError("Audio timestamps must include a timezone")
            if ended < started:
                raise ValueError("Audio end time precedes its start")
            folder = os.path.join(session_path(record["date"], record["session_id"]), "audio")
            # Chỉ lưu phần cuối vào phiên gốc còn tồn tại, không tái tạo phiên đã xóa.
            if not os.path.isdir(os.path.dirname(folder)):
                raise HTTPException(404, "The audio session was deleted")
            os.makedirs(folder, exist_ok=True)
            extension = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a"}[payload.mime]
            path = os.path.join(folder, f"voice_{uuid4().hex}{extension}")
            with open(path, "wb") as file:
                file.write(data)
            event = {"type": "AUDIO_NOTE", "timestamp": started.astimezone().strftime("%H:%M:%S"), "audio_path": path, "audio_started_at": payload.started_at, "audio_ended_at": payload.ended_at, "warnings": [], "strategy": record["strategy"]}
            frames = [frame for frame in record["frames"] if started <= datetime.fromisoformat(frame["captured_at"]) <= ended][-8:]
            if frames:
                event["observation_frames"] = frames
                event["frame_path"] = frames[-1]["path"]
                event["frame_captured_at"] = frames[-1]["captured_at"]
            current_source = record["date"] == logger.current_date and record["session_id"] == logger.session_id and record["generation"] == state["capture_generation"] and record["mode"] == state["mode"] and state["recording_status"] == "recording"
            if current_source and not frames:
                try:
                    require_recording(record["source_id"])
                    if payload.frame_captured_at:
                        frame_time = datetime.fromisoformat(payload.frame_captured_at.replace("Z", "+00:00"))
                        if frame_time.utcoffset() is None:
                            raise ValueError("Frame timestamp must include a timezone")
                    event["frame_path"] = capture(payload.frame_base64)
                    event["frame_captured_at"] = payload.frame_captured_at if state["mode"] == "IN_APP" else datetime.now().astimezone().isoformat()
                except (HTTPException, ValueError) as error:
                    event["capture_error"] = str(error.detail) if isinstance(error, HTTPException) else str(error)
            if not logger.append_to_session(event, record["date"], record["session_id"]):
                raise HTTPException(404, "The audio session was deleted")
            record["expires"] = time.monotonic() + 120
            if record["date"] == logger.current_date and record["session_id"] == logger.session_id:
                prepare_analysis(event)
            await broadcast({"type": "EVENT_LOGGED", "event": event, "date": record["date"], "session_id": record["session_id"]})
            if event.get("ai_pending"):
                queue_analysis(event)
            return {"event": event}
        except (ValueError, OSError) as error:
            raise HTTPException(400, f"Audio save failed: {error}") from error

    @app.delete("/api/audio/{token}")
    def audio_stop(token: str):
        audio_tokens.pop(token, None)
        return {"status": "stopped"}

    @app.post("/api/strategy-mode")
    async def strategy_mode(payload: StrategyModePayload):
        nonlocal strategy_revision
        refresh_strategy()
        if payload.enabled and (not strategy_documents or strategy_errors):
            raise HTTPException(409, "Add a complete Markdown strategy document before enabling strategy review.")
        previous = config.get("strategy_mode", False)
        config["strategy_mode"] = payload.enabled
        try:
            save_config()
        except HTTPException:
            config["strategy_mode"] = previous
            raise
        state["strategy_mode"] = payload.enabled
        strategy_revision += 1
        await publish_strategy()
        return {"status": "ok", "strategy_mode": payload.enabled}

    async def publish_strategy():
        nonlocal strategy_changed
        strategy_changed = False
        await broadcast(strategy_message())

    @app.post("/api/mode")
    async def mode(payload: ModePayload):
        details = window_details(payload.target_window_id) if payload.mode == "DESKTOP" and payload.target_window_id else None
        if payload.target_window_id and not details:
            raise HTTPException(409, "That window is unavailable. Refresh the window list.")
        if payload.mode == "IN_APP" and payload.browser_source_id and not any(ws.query_params.get("client_id") == payload.browser_source_id for ws in clients):
            raise HTTPException(409, "Reconnect this browser before selecting a capture source")
        previous = dict(config)
        config.update(mode=payload.mode)
        try:
            save_config()
        except HTTPException:
            config.clear()
            config.update(previous)
            raise
        stop_recording("stopped")
        state.update(mode=payload.mode, target_window_title=details["title"] if details else "", target_window_id=details["id"] if details else 0, browser_source_id=payload.browser_source_id if payload.mode == "IN_APP" else "")
        if state["auto_start_recording"] and logger.session_id and (details or state["browser_source_id"]):
            try:
                start_recording(state["browser_source_id"])
            except HTTPException as error:
                state["recording_error"] = str(error.detail)
        await broadcast({"type": "MODE_CHANGED", **state})
        return {"status": "ok", **state}

    def capture(frame_base64):
        if state["mode"] == "DESKTOP":
            image = listener.capture_screen()
            if not image:
                raise HTTPException(503, listener.last_error or "The selected window cannot be captured")
            return image
        if frame_base64:
            try:
                data = base64.b64decode(frame_base64.split(",")[-1], validate=True)
                if len(data) > 20 * 1024 * 1024 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Expected a PNG image under 20 MB")
                path = os.path.join(logger.frames_dir, f"tab_{uuid4().hex}.png")
                with open(path, "wb") as file:
                    file.write(data)
                return path
            except (ValueError, OSError) as error:
                raise HTTPException(400, f"Capture failed: {error}") from error
        raise HTTPException(409, "No browser frame is available. Select the source again.")

    def prepare_analysis(event):
        reference = strategy_context()
        event["ai_pending"] = bool(analyzer.connection.get("connected"))
        event["ai_status"] = "queued" if event["ai_pending"] else "idle"
        if event["ai_pending"]:
            event["ai_error"] = ""
            event["ai_requested_at"] = datetime.now(timezone.utc).isoformat()
            event["ai_started_at"] = None
            event["ai_settings"] = dict(analyzer.settings)
            event["ai_connection_revision"] = analyzer._catalog_revision
            event["ai_strategy_revision"] = strategy_revision
            event["ai_strategy_context"] = reference
        logger.update_event(event["id"], {key: event[key] for key in ("ai_pending", "ai_status", "ai_requested_at", "ai_started_at", "ai_settings", "ai_connection_revision", "ai_strategy_revision", "ai_strategy_context", "ai_error") if key in event})

    def queue_analysis(event):
        nonlocal analysis_worker
        refresh_strategy()
        if not analyzer.connection.get("connected"):
            logger.update_event(event["id"], {"ai_pending": False, "ai_status": "idle"})
            return
        if not event.get("ai_pending") or event.get("ai_status") != "queued":
            prepare_analysis(event)
        if not event.get("ai_pending") or event["id"] in pending_analysis:
            return
        queued_sessions.add((event["date"], event["session_id"]))
        if analysis_worker is None or analysis_worker.done():
            analysis_worker = asyncio.create_task(drain_analysis())

    async def drain_analysis():
        # Hàng chờ nằm trong nhật ký; chỉ một worker mở CLI và giữ ngữ cảnh phân tích.
        while queued_sessions:
            candidates = []
            for date, session_id in list(queued_sessions):
                events = session_events(date, session_id)
                event = min((item for item in events if item.get("ai_pending") and item.get("ai_status") == "queued"), key=lambda item: item.get("ai_requested_at", ""), default=None)
                if event is None:
                    queued_sessions.discard((date, session_id))
                else:
                    candidates.append(event)
            if not candidates:
                return
            event = min(candidates, key=lambda item: item.get("ai_requested_at", ""))
            pending_analysis.add(event["id"])
            try:
                await analyze(event)
            except Exception:
                updates = {"ai_pending": False, "ai_status": "failed", "ai_error": "Không hoàn tất lượt phân tích. Minh chứng đã được lưu; hãy thử lại."}
                if logger.update_event(event["id"], updates, event["date"], event["session_id"]):
                    event.update(updates)
                    await broadcast({"type": "EVENT_UPDATED", "event": event, "date": event["date"], "session_id": event["session_id"]})
            finally:
                pending_analysis.discard(event["id"])

    async def analyze(event):
        date, session_id = event["date"], event["session_id"]
        updates = {"ai_status": "processing", "ai_started_at": datetime.now(timezone.utc).isoformat()}
        if not logger.update_event(event["id"], updates, date, session_id):
            return
        event.update(updates)
        await broadcast({"type": "EVENT_UPDATED", "event": event, "date": date, "session_id": session_id})
        context = copy.deepcopy(event)
        originals = session_events(date, session_id)
        context["prior_observations"] = [{"event_id": source["id"], "timestamp": source["timestamp"], "observation": source.get("ai_thesis", "")[:1400], "spoken_explanation": (source.get("ai_transcript") or source.get("voice_transcript") or source.get("reason", ""))[:1400], "limitations": source.get("ai_evidence_limitations", "")[:600]} for source in originals if source["id"] != event["id"] and (source.get("ai_thesis") or source.get("ai_transcript") or source.get("voice_transcript") or source.get("reason")) and not source.get("ai_error")][-20:]
        context["recorded_executions"] = [{key: trade.get(key) for key in ("action", "price", "contracts", "timestamp", "execution_id", "instrument")} for trade in recorded_trades(originals)[-100:]]
        revision = context.get("ai_strategy_revision", strategy_revision)

        def reference_is_current():
            reference = context.get("ai_strategy_context", {})
            if bool(reference.get("enabled")) != state["strategy_mode"]:
                return False
            if not reference.get("enabled"):
                return revision == strategy_revision
            documents, errors = load_strategy_documents(config, config_path)
            return bool(revision == strategy_revision and documents and not errors and documents == reference.get("documents"))

        async def complete_analysis():
            try:
                try:
                    if context.get("ai_connection_revision", analyzer._catalog_revision) != analyzer._catalog_revision:
                        result = {"ai_error": "AI account or configuration changed while queued. Evidence is saved; check the selected connection and retry."}
                    else:
                        result = await asyncio.to_thread(analyzer.analyze_event, context.get("frame_path"), context.get("audio_path"), context, f"{date}_{session_id}", reference_is_current)
                    if not reference_is_current():
                        result = {"ai_error": "Observation mode or strategy reference changed. Evidence is saved; retry in the current mode."}
                except Exception as error:
                    result = {"ai_error": str(error)}
                updates = {key: result.get(key, False if key == "ai_strategy_difference" else "") for key in ("ai_thesis", "ai_error", "ai_question", "ai_strategy_difference", "ai_evidence_limitations", "ai_transcript", "model_used")}
                updates["ai_pending"] = False
                updates["ai_status"] = "failed" if updates["ai_error"] else "complete"
                history = list(event.get("analysis_history", []))
                if not history and event.get("ai_thesis"):
                    history.append({"observation": event["ai_thesis"], "question": event.get("ai_question", ""), "model": event.get("model_used")})
                history.append({"observation": updates["ai_thesis"], "question": updates["ai_question"], "error": updates["ai_error"], "model": result.get("model_used"), "timestamp": datetime.now(timezone.utc).isoformat()})
                updates["analysis_history"] = history
                if not updates["ai_error"]:
                    try:
                        updates["ai_trade_observations"] = identify_candidates(result.get("ai_trade_observations", []), event["id"])
                        original_events = session_events(date, session_id)
                        original = next((item for item in original_events if item["id"] == event["id"]), event)
                        updates["observed_fills"] = auto_record_candidates(updates["ai_trade_observations"], original_events, original.get("observed_fills", []))
                    except (ValueError, OSError) as error:
                        updates.pop("ai_trade_observations", None)
                        updates["ai_error"] = f"Could not record detected executions: {error}"
                        updates["ai_status"] = "failed"
                # Gắn kết quả vào phiên gốc khi người dùng đã chuyển phiên.
                if logger.update_event(event["id"], updates, date, session_id):
                    event.update(updates)
                    current = date == logger.current_date and session_id == logger.session_id
                    if current:
                        replay_session()
                    await broadcast({"type": "EVENT_UPDATED", "event": event, "date": date, "session_id": session_id, **({"summary": pair_manager.get_summary()} if current else {})})
            finally:
                if event.get("ai_pending"):
                    logger.update_event(event["id"], {"ai_pending": False, "ai_status": "failed", "ai_error": "Analysis was interrupted. Evidence remains saved for retry."}, date, session_id)

        await complete_analysis()

    @app.post("/api/observation")
    async def observation(payload: ObservationPayload):
        require_session(payload.session_id, payload.session_date)
        require_recording(payload.source_id)
        if payload.capture_generation is not None and payload.capture_generation != state["capture_generation"]:
            raise HTTPException(409, "The capture source changed")
        event = {"type": "OBSERVATION", "reason": payload.reason.strip(), "timestamp": datetime.now().strftime("%H:%M:%S"), "warnings": [], "frame_path": capture(payload.frame_base64), "strategy": strategy_context()}
        logger.log_event(event)
        prepare_analysis(event)
        await broadcast({"type": "EVENT_LOGGED", "event": event})
        if event["ai_pending"]:
            queue_analysis(event)
        return {"event": event}

    def active_event(event_id, date, session_id):
        require_session(session_id, date)
        if date != logger.current_date or session_id != logger.session_id:
            raise HTTPException(409, "Select the event's original session before reviewing it")
        event = next((item for item in logger.events if item["id"] == event_id), None)
        if event is None:
            raise HTTPException(404, "Event not found in the active session")
        return event

    def session_events(date, session_id):
        if date == logger.current_date and session_id == logger.session_id:
            return logger.events
        path = os.path.join(session_path(date, session_id), "events.jsonl")
        if not os.path.isfile(path):
            return []
        with open(path, encoding="utf-8") as file:
            return [json.loads(line) for line in file if line.strip()]

    @app.post("/api/events/{event_id}/fill")
    async def review_fill(event_id: str, payload: FillReviewPayload):
        event = active_event(event_id, payload.date, payload.session_id)
        if event.get("ai_pending"):
            raise HTTPException(409, "Wait for the current analysis to finish")
        records = copy.deepcopy(event.get("observed_fills", []))
        record = next((item for item in records if item["id"] == payload.candidate_id), None)
        candidate = next((item for item in event.get("ai_trade_observations", []) if item["id"] == payload.candidate_id), None)
        if not record and not candidate:
            raise HTTPException(404, "Observed fill was not found")
        if record is None:
            record = {**candidate, "source_execution_id": candidate.get("execution_id", "")}
            records.append(record)
        previous = dict(record)
        if payload.decision == "confirm":
            if not payload.action or not payload.price or not payload.contracts or not payload.timestamp or payload.instrument.upper() != "VN30F1M":
                raise HTTPException(400, "Confirm BUY/SELL, filled price, quantity, time and VN30F1M before counting")
            execution_id = payload.execution_id.strip()
            if execution_id and any(execution_id in (item.get("execution_id"), item.get("source_execution_id")) for source in logger.events for item in source.get("observed_fills", []) if item.get("status") == "confirmed" and (source["id"] != event_id or item["id"] != record["id"])):
                raise HTTPException(409, "This execution is already recorded in the session")
            record.update(action=payload.action, price=payload.price, contracts=payload.contracts, timestamp=payload.timestamp, instrument="VN30F1M", execution_id=execution_id, status="confirmed", reviewed_by="trader")
        else:
            record.update(status="excluded", reviewed_by="trader")
        history = [*event.get("fill_review_history", []), {"id": record["id"], "before": previous, "after": dict(record), "timestamp": datetime.now().isoformat()}]
        if len(history) > 200:
            raise HTTPException(409, "Fill review history is full")
        if not logger.update_event(event_id, {"observed_fills": records, "fill_review_history": history}):
            raise HTTPException(404, "The event is no longer available")
        replay_session()
        summary = pair_manager.get_summary()
        await broadcast({"type": "EVENT_UPDATED", "event": event, "summary": summary})
        return {"event": event, "summary": summary}

    @app.post("/api/events/{event_id}/analyze")
    async def analyze_saved(event_id: str, payload: SwitchSessionPayload):
        event = active_event(event_id, payload.date, payload.session_id)
        refresh_strategy()
        if not analyzer.connection.get("connected"):
            raise HTTPException(409, "Check the selected AI connection first")
        if event.get("ai_pending"):
            raise HTTPException(409, "This observation is already being reviewed")
        if len(event.get("analysis_history", [])) >= 100:
            raise HTTPException(409, "The analysis history for this event is full")
        prepare_analysis(event)
        await broadcast({"type": "EVENT_UPDATED", "event": event})
        if event["ai_pending"]:
            queue_analysis(event)
        return {"event": event}

    async def log_trade(payload):
        require_session(payload.session_id, payload.session_date)
        require_recording(payload.source_id)
        frame_path = capture(payload.frame_base64)
        timestamp = datetime.now().strftime("%H:%M:%S")
        warnings = []
        result = pair_manager.register_trade(payload.action, payload.price, timestamp, payload.contracts)
        event = {"type": payload.type, "action": payload.action, "price": payload.price, "contracts": payload.contracts, "timestamp": timestamp, "voice_transcript": payload.voice_transcript, "drawing_data": payload.drawing_data.model_dump() if payload.drawing_data else None, "warnings": warnings, "trade_result": result, "frame_path": frame_path, "ai_pending": True}
        event["strategy"] = strategy_context()
        logger.log_event(event)
        prepare_analysis(event)
        summary = pair_manager.get_summary()
        await broadcast({"type": "TRADE_LOGGED", "event": event, "summary": summary})
        queue_analysis(event)
        return {"status": "ok", "event": event, "summary": summary}

    @app.post("/api/trade")
    async def trade(payload: TradeEventPayload):
        return await log_trade(payload)

    @app.post("/api/end-session", dependencies=[Depends(empty_body)])
    async def export():
        require_session()
        report_logger = copy.copy(logger)
        report_logger.events = [dict(event) for event in logger.events]
        summary = pair_manager.get_summary()
        reports = await asyncio.to_thread(report_logger.export_reports, summary)
        return {"status": "ended", "date": report_logger.current_date, "session_id": report_logger.session_id, "summary": summary, "reports": reports}

    socket_tickets = {}

    @app.post("/api/socket-ticket")
    def socket_ticket(payload: SocketTicketPayload):
        now = time.monotonic()
        for ticket, entry in list(socket_tickets.items()):
            if entry["expires"] < now:
                socket_tickets.pop(ticket, None)
        if len(socket_tickets) >= 32:
            raise HTTPException(429, "Too many connection attempts")
        ticket = uuid4().hex
        socket_tickets[ticket] = {"expires": now + 30, "client_id": payload.client_id}
        return {"ticket": ticket}

    @app.websocket("/ws")
    async def websocket(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        entry = socket_tickets.pop(websocket.query_params.get("ticket", ""), None)
        if not workspace_origin(origin) or not entry or entry["expires"] < time.monotonic() or entry["client_id"] != websocket.query_params.get("client_id"):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        clients.append(websocket)
        try:
            await websocket.send_json({"type": "INIT_STATE", **snapshot()})
            while True:
                raw = await websocket.receive_text()
                if len(raw) > 65536:
                    await websocket.close(code=1009)
                    break
                try:
                    message = json.loads(raw)
                    if not isinstance(message, dict):
                        raise ValueError("Expected object")
                    if message.get("type") in ("TRADE_OPEN", "TRADE_CLOSE"):
                        payload = TradeEventPayload.model_validate(message)
                    else:
                        payload = DrawingEventPayload.model_validate(message)
                    if payload.source_id != entry["client_id"]:
                        raise ValueError("Source mismatch")
                except (ValidationError, ValueError):
                    await websocket.send_json({"type": "ERROR", "message": "Invalid event payload"})
                    continue
                if message.get("type") in ("TRADE_OPEN", "TRADE_CLOSE"):
                    try:
                        await log_trade(payload)
                    except HTTPException as error:
                        await websocket.send_json({"type": "ERROR", "message": error.detail})
                elif message.get("type") == "DRAWING":
                    try:
                        require_recording(payload.source_id)
                    except HTTPException as error:
                        await websocket.send_json({"type": "ERROR", "message": error.detail})
                        continue
                    event = {"type": "DRAWING", "drawing_data": payload.drawing_data.model_dump(), "timestamp": datetime.now().strftime("%H:%M:%S"), "warnings": []}
                    event["strategy"] = strategy_context()
                    logger.log_event(event)
                    prepare_analysis(event)
                    await broadcast({"type": "EVENT_LOGGED", "event": event, "summary": pair_manager.get_summary()})
                    if event["ai_pending"]:
                        queue_analysis(event)
        except WebSocketDisconnect:
            pass
        finally:
            if websocket in clients:
                clients.remove(websocket)
            owner = websocket.query_params.get("client_id")
            if owner and state["mode"] == "IN_APP" and owner == state["browser_source_id"] and not any(ws.query_params.get("client_id") == owner for ws in clients):
                state["browser_source_id"] = ""
                stop_recording(error="Browser sharing disconnected. Select a source to continue.")
                await broadcast({"type": "RECORDING_CHANGED", **state})

    @app.get("/")
    @app.get("/auditor")
    def frontend():
        return RedirectResponse(os.getenv("AUDITOR_UI_URL", "http://localhost:3000/auditor"))

    return app

