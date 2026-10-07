import os
import sys
import json
import asyncio
import base64
import shutil
import copy
import subprocess
from pathlib import Path
from uuid import uuid4
from datetime import datetime
from typing import Any, Dict, Literal, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .core import TradePairManager, StrategyConflictAuditor, SessionLogger
from .gemini_analyzer import GeminiMultimodalAnalyzer
from .desktop_listener import DesktopListener, list_windows, window_details


class TerminalPayload(BaseModel):
    terminal_type: Optional[Literal["ORCA", "WINDOWS", "WT", "NONE"]] = None


class TradeEventPayload(BaseModel):
    type: Literal["TRADE_MANUAL", "TRADE_OPEN", "TRADE_CLOSE"] = "TRADE_MANUAL"
    action: Literal["BUY", "SELL"]
    price: float = Field(gt=0, allow_inf_nan=False)
    contracts: int = Field(default=1, ge=1, le=1000)
    voice_transcript: str = ""
    drawing_data: Optional[Dict[str, Any]] = None
    frame_base64: Optional[str] = None
    session_id: Optional[str] = None
    session_date: Optional[str] = None
    source_id: str = ""


class RejectPayload(BaseModel):
    reason: str = ""
    voice_transcript: str = ""
    frame_base64: Optional[str] = None
    session_id: Optional[str] = None
    session_date: Optional[str] = None
    source_id: str = ""


class ModePayload(BaseModel):
    mode: Literal["DESKTOP", "IN_APP"]
    target_window_title: str = ""
    target_window_id: int = 0
    browser_source_id: str = ""


class RecordingPayload(BaseModel):
    action: Literal["start", "pause", "resume", "stop"]
    source_id: str = ""
    browser_only: bool = False
    capture_generation: Optional[int] = None


class RecordingPreference(BaseModel):
    auto_start: bool


class DecisionTestPayload(RejectPayload):
    direction: Literal["LONG", "SHORT"]
    price: float = Field(gt=0, allow_inf_nan=False)
    contracts: int = Field(default=1, ge=1, le=1000)
    save: bool = False


class StrategyModePayload(BaseModel):
    enabled: bool


class StrategyPayload(BaseModel):
    notes: str = Field(default="", max_length=20000)
    enabled: bool = True


class SwitchSessionPayload(BaseModel):
    date: str
    session_id: str


def create_app(config_path: str = "config.json") -> FastAPI:
    config_path = os.path.abspath(config_path)
    config = {}
    if os.path.isfile(config_path):
        with open(config_path, encoding="utf-8-sig") as file:
            config = json.load(file)
    config.pop("gemini_api_key", None)
    # Không kích hoạt các giả định cũ trước khi người dùng lưu chiến lược.
    if not config.get("strategy_configured"):
        config["strategy_notes"] = ""
        config["strategy_guardrails"] = {key: value for key, value in config.get("strategy_guardrails", {}).items() if key == "fee_per_closed_pair"}
    config["strategy_mode"] = bool(config.get("strategy_mode", False) and config.get("strategy_notes", "").strip())
    app = FastAPI(title="Quant Strategy Auditor Bridge")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    guardrails = config.get("strategy_guardrails", {})
    pair_manager = TradePairManager(fee_per_pair=guardrails.get("fee_per_closed_pair", 0.45))
    auditor = StrategyConflictAuditor(guardrails, enabled=config["strategy_mode"])
    logger = SessionLogger(os.path.join(os.path.dirname(config_path), config.get("storage", {}).get("sessions_dir", "sessions")))
    analyzer = GeminiMultimodalAnalyzer()
    state = {"mode": config.get("mode", "DESKTOP"), "target_window_title": "", "target_window_id": 0, "browser_source_id": "", "strategy_mode": auditor.enabled, "recording_status": "stopped", "recording_error": "", "auto_start_recording": config.get("auto_start_recording", True), "capture_generation": 0}
    clients = []
    main_loop = None
    source_monitor = None
    pending_analysis = set()

    def replay_session():
        pair_manager.reset()
        auditor.reset()
        for event in logger.events:
            if event.get("ai_pending") and event["id"] not in pending_analysis:
                logger.update_event(event["id"], {"ai_pending": False, "ai_error": "Analysis was interrupted by an engine restart."})
            action = event.get("action", "").upper()
            price = float(event.get("price") or 0)
            if action in ("BUY", "SELL") and price > 0:
                pair_manager.register_trade(action, price, event.get("timestamp", ""), int(event.get("contracts", 1)))
            if event.get("type") in ("TRADE_OPEN", "TRADE_CLOSE", "TRADE_MANUAL"):
                auditor.trade_count += 1

    replay_session()

    def snapshot():
        return {**state, "protocol_version": 3, "current_date": logger.current_date, "date": logger.current_date, "session_id": logger.session_id, "is_recording": state["recording_status"] == "recording", "summary": pair_manager.get_summary(), "recent_events": logger.events[-200:], "gemini_status": analyzer.status(), "config": config}

    def strategy_context():
        return {"enabled": auditor.enabled, "notes": config.get("strategy_notes", ""), "rules": copy.deepcopy({key: value for key, value in auditor.guardrails.items() if key != "fee_per_closed_pair"})}

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
            raise HTTPException(500, f"Cannot save preference: {error}") from error
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
        event["warnings"] = auditor.audit(event_type=event["type"])
        event["strategy"] = strategy_context()
        logger.log_event(event)
        await broadcast({"type": "EVENT_LOGGED", "event": event, "summary": pair_manager.get_summary()})

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
        while True:
            await asyncio.sleep(1)
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
        listener.stop()

    def open_terminal(terminal_type):
        require_session()
        term = terminal_type or config.get("terminal_type", "ORCA")
        if term == "NONE":
            return {"status": "disabled", "terminal_type": term}
        script = str(Path(__file__).with_name("session_terminal.py"))
        worktree = str(Path(__file__).resolve().parents[3])
        arguments = [sys.executable, script, "--date", logger.current_date, "--session", logger.session_id]
        command = "& " + " ".join("'" + value.replace("'", "''") + "'" for value in arguments)
        title = f"Auditor [{logger.current_date} {logger.session_id[8:14]}]"
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
            raise HTTPException(503, f"Terminal launch failed: {error}") from error

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
    def gemini_status():
        return analyzer.test_connection()

    @app.get("/api/terminal/config")
    def terminal_config():
        return {"terminal_type": config.get("terminal_type", "ORCA"), "supported": ["ORCA", "WINDOWS", "WT", "NONE"]}

    @app.post("/api/terminal/config")
    def set_terminal_config(payload: TerminalPayload):
        previous = config.get("terminal_type", "ORCA")
        config["terminal_type"] = payload.terminal_type or previous
        try:
            save_config()
        except HTTPException:
            config["terminal_type"] = previous
            raise
        return terminal_config()

    @app.post("/api/terminal/open")
    def terminal_open(payload: Optional[TerminalPayload] = None):
        return open_terminal(payload.terminal_type if payload else None)

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

    @app.post("/api/sessions/new")
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

    @app.post("/api/strategy-mode")
    async def strategy_mode(payload: StrategyModePayload):
        if payload.enabled and not config.get("strategy_notes", "").strip():
            raise HTTPException(409, "Save your strategy before enabling strategy review.")
        previous = config.get("strategy_mode", False)
        config["strategy_mode"] = payload.enabled
        try:
            save_config()
        except HTTPException:
            config["strategy_mode"] = previous
            raise
        state["strategy_mode"] = auditor.enabled = payload.enabled
        await broadcast({"type": "STRATEGY_MODE_CHANGED", "enabled": payload.enabled})
        return {"status": "ok", "strategy_mode": payload.enabled}

    @app.post("/api/strategy")
    async def strategy(payload: StrategyPayload):
        previous = copy.deepcopy(config)
        notes = payload.notes.strip()
        enabled = bool(notes and payload.enabled)
        config.update(strategy_notes=notes, strategy_configured=bool(notes), strategy_mode=enabled)
        config["strategy_guardrails"] = {key: value for key, value in auditor.guardrails.items() if key == "fee_per_closed_pair"}
        try:
            save_config()
        except HTTPException:
            config.clear()
            config.update(previous)
            raise
        state["strategy_mode"] = auditor.enabled = enabled
        auditor.guardrails = config["strategy_guardrails"]
        result = {"strategy_mode": enabled, "config": copy.deepcopy(config)}
        await broadcast({"type": "STRATEGY_CHANGED", **result})
        return {"status": "ok", **result}

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

    def queue_analysis(event):
        date, session_id = event["date"], event["session_id"]
        pending_analysis.add(event["id"])

        async def analyze():
            try:
                result = await asyncio.to_thread(analyzer.analyze_event, event.get("frame_path"), None, event, f"{date}_{session_id}")
                updates = {"ai_thesis": result.get("ai_thesis", ""), "ai_error": result.get("ai_error", ""), "ai_pending": False}
                # Gắn kết quả vào phiên gốc khi người dùng đã chuyển phiên.
                if logger.update_event(event["id"], updates, date, session_id):
                    event.update(updates)
                    await broadcast({"type": "EVENT_UPDATED", "event": event, "date": date, "session_id": session_id})
            finally:
                pending_analysis.discard(event["id"])

        asyncio.create_task(analyze())

    async def log_trade(payload):
        require_session(payload.session_id, payload.session_date)
        require_recording(payload.source_id)
        frame_path = capture(payload.frame_base64)
        timestamp = datetime.now().strftime("%H:%M:%S")
        warnings = auditor.audit(payload.type, payload.action, payload.price)
        result = pair_manager.register_trade(payload.action, payload.price, timestamp, payload.contracts)
        event = {"type": payload.type, "action": payload.action, "price": payload.price, "contracts": payload.contracts, "timestamp": timestamp, "voice_transcript": payload.voice_transcript, "drawing_data": payload.drawing_data, "warnings": warnings, "trade_result": result, "frame_path": frame_path, "ai_pending": True}
        event["strategy"] = strategy_context()
        logger.log_event(event)
        summary = pair_manager.get_summary()
        await broadcast({"type": "TRADE_LOGGED", "event": event, "summary": summary})
        queue_analysis(event)
        return {"status": "ok", "event": event, "summary": summary}

    @app.post("/api/trade")
    async def trade(payload: TradeEventPayload):
        return await log_trade(payload)

    @app.post("/api/reject-setup")
    async def reject(payload: RejectPayload):
        require_session(payload.session_id, payload.session_date)
        require_recording(payload.source_id)
        event = {"type": "REJECTED_SETUP", "action": "REJECT", "reason": payload.reason, "voice_transcript": payload.voice_transcript, "timestamp": datetime.now().strftime("%H:%M:%S"), "warnings": [], "frame_path": capture(payload.frame_base64), "ai_pending": True}
        event["strategy"] = strategy_context()
        logger.log_event(event)
        await broadcast({"type": "REJECT_LOGGED", "event": event, "summary": pair_manager.get_summary()})
        queue_analysis(event)
        return {"status": "ok", "event": event}

    @app.post("/api/decision-test")
    async def decision_test(payload: DecisionTestPayload):
        preview_auditor = copy.copy(auditor)
        warnings = preview_auditor.audit("TRADE_MANUAL", payload.direction, payload.price)
        result = {"direction": payload.direction, "price": payload.price, "contracts": payload.contracts, "warnings": warnings, "saved": False}
        if not payload.save:
            return result
        require_session(payload.session_id, payload.session_date)
        require_recording(payload.source_id)
        event = {"type": "DECISION_TEST", "action": payload.direction, "price": payload.price, "contracts": payload.contracts, "voice_transcript": payload.voice_transcript, "timestamp": datetime.now().strftime("%H:%M:%S"), "warnings": warnings, "frame_path": capture(payload.frame_base64), "ai_pending": True}
        event["strategy"] = strategy_context()
        logger.log_event(event)
        await broadcast({"type": "EVENT_LOGGED", "event": event, "summary": pair_manager.get_summary()})
        queue_analysis(event)
        return {**result, "saved": True, "event": event}

    @app.post("/api/end-session")
    async def export():
        require_session()
        report_logger = copy.copy(logger)
        report_logger.events = [dict(event) for event in logger.events]
        summary = pair_manager.get_summary()
        reports = await asyncio.to_thread(report_logger.export_reports, summary)
        return {"status": "ended", "date": report_logger.current_date, "session_id": report_logger.session_id, "summary": summary, "reports": reports}

    @app.websocket("/ws")
    async def websocket(websocket: WebSocket):
        await websocket.accept()
        clients.append(websocket)
        try:
            await websocket.send_json({"type": "INIT_STATE", **snapshot()})
            while True:
                message = await websocket.receive_json()
                if message.get("type") in ("TRADE_OPEN", "TRADE_CLOSE"):
                    try:
                        await log_trade(TradeEventPayload(**message))
                    except Exception as error:
                        await websocket.send_json({"type": "ERROR", "message": str(error)})
                elif message.get("type") == "DRAWING":
                    try:
                        require_recording(message.get("source_id", ""))
                    except HTTPException as error:
                        await websocket.send_json({"type": "ERROR", "message": error.detail})
                        continue
                    event = {"type": "DRAWING", "drawing_data": message.get("drawing_data", {}), "timestamp": datetime.now().strftime("%H:%M:%S"), "warnings": auditor.audit("DRAWING")}
                    event["strategy"] = strategy_context()
                    logger.log_event(event)
                    await broadcast({"type": "EVENT_LOGGED", "event": event, "summary": pair_manager.get_summary()})
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

