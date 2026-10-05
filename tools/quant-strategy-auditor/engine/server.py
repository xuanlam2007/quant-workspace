import os
import json
import csv
import io
import asyncio
import subprocess
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .core import TradePairManager, StrategyConflictAuditor, SessionLogger
from .gemini_analyzer import GeminiMultimodalAnalyzer
from .desktop_listener import DesktopListener

def get_system_windows() -> List[str]:
    titles = []
    try:
        res = subprocess.run(
            ["tasklist", "/v", "/fo", "csv"],
            capture_output=True,
            text=True,
            encoding="cp1252",
            errors="ignore",
            timeout=3
        )
        reader = csv.DictReader(io.StringIO(res.stdout))
        ignore_titles = {
            "N/A", "", "DWM Notification Window", "Task Host Window",
            "BroadcastListenerWindow", "RealtekAudioAdminBackgroundProcessClass",
            "RealtekAudioBackgroundProcessClass", "CrossDeviceResumeWindow",
            "Windows Push Notifications Platform", "OLEChannelWnd", "NvSvc", "UxdService"
        }
        for row in reader:
            title = (row.get("Window Title") or "").strip()
            if title and title not in ignore_titles and title not in titles:
                titles.append(title)
    except Exception:
        pass
    
    return sorted(titles)

def create_app(config_path: str = "config.json") -> FastAPI:
    app = FastAPI(title="Quant Strategy Auditor Bridge")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    config = {}
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)

    guardrails = config.get("strategy_guardrails", {})
    pair_manager = TradePairManager(fee_per_pair=guardrails.get("fee_per_closed_pair", 0.45))
    auditor = StrategyConflictAuditor(guardrails=guardrails, enabled=config.get("strategy_mode", True))
    sessions_root = os.path.join(os.path.dirname(config_path), config.get("storage", {}).get("sessions_dir", "sessions"))
    logger = SessionLogger(base_dir=sessions_root)
    analyzer = GeminiMultimodalAnalyzer(api_key=config.get("gemini_api_key", ""))

    state = {
        "mode": config.get("mode", "DESKTOP"),
        "target_window_title": config.get("target_window_title", "VNDIRECT"),
        "strategy_mode": config.get("strategy_mode", True),
        "is_recording": True,
        "config": config,
        "config_path": config_path
    }

    connected_clients: List[WebSocket] = []
    main_loop = None

    def open_session_terminal(date_str: str, session_id: str, terminal_type: Optional[str] = None):
        def _launch():
            try:
                import shutil
                current_dir = os.path.dirname(os.path.abspath(__file__))
                script_path = os.path.join(current_dir, "session_terminal.py")
                time_part = session_id.replace("session_", "")
                title_time = f"{time_part[:2]}:{time_part[2:4]}" if len(time_part) == 6 else time_part
                tab_title = f"Auditor AI [{date_str} {title_time}]"
                
                term = (terminal_type or state["config"].get("terminal_type", "ORCA")).upper()
                if term == "NONE":
                    return

                if term == "ORCA":
                    orca_path = shutil.which("orca") or os.path.expandvars(r"%LocalAppData%\Programs\orca\resources\bin\orca.exe")
                    if os.path.exists(orca_path):
                        res = subprocess.run([orca_path, "terminal", "create", "--title", tab_title, "--focus", "--json"], capture_output=True, text=True, timeout=5)
                        if res.returncode == 0:
                            data = json.loads(res.stdout)
                            handle = data.get("result", {}).get("terminal", {}).get("handle")
                            if handle:
                                cmd = f'python "{script_path}" --date {date_str} --session {session_id}'
                                subprocess.run([orca_path, "terminal", "send", "--terminal", handle, "--text", cmd, "--enter", "--json"], capture_output=True, timeout=5)
                                return
                    # Fallback sang Windows console host nếu Orca không khả dụng
                    term = "WINDOWS"

                if term == "WT":
                    wt_path = shutil.which("wt") or os.path.expandvars(r"%LocalAppData%\Microsoft\WindowsApps\wt.exe")
                    if os.path.exists(wt_path):
                        cmd = f'python "{script_path}" --date {date_str} --session {session_id}'
                        subprocess.Popen([wt_path, "--title", tab_title, "cmd.exe", "/k", cmd])
                        return
                    term = "WINDOWS"

                if term in ("WINDOWS", "CONHOST"):
                    conhost_path = shutil.which("conhost") or "conhost.exe"
                    cmd = f'title {tab_title} && python "{script_path}" --date {date_str} --session {session_id}'
                    subprocess.Popen([conhost_path, "cmd.exe", "/k", cmd])
            except Exception:
                pass
        
        threading.Thread(target=_launch, daemon=True).start()

    @app.on_event("startup")
    async def on_startup():
        nonlocal main_loop
        main_loop = asyncio.get_running_loop()
        # Tự động mở terminal giám sát phiên giao dịch theo cấu hình người dùng
        open_session_terminal(logger.current_date, logger.session_id)

    async def broadcast(message: Dict[str, Any]):
        dead = []
        for ws in list(connected_clients):
            try:
                await ws.send_text(json.dumps(message, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in connected_clients:
                try:
                    connected_clients.remove(ws)
                except ValueError:
                    pass

    def on_desktop_event(event_data: Dict[str, Any]):
        if not state["is_recording"]:
            return
        warnings = auditor.audit(event_type=event_data["type"])
        event_data["warnings"] = warnings
        logger.log_event(event_data)
        msg = {"type": "EVENT_LOGGED", "event": event_data, "summary": pair_manager.get_summary()}
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(broadcast(msg), main_loop)

    listener = DesktopListener(
        target_window_title=state["target_window_title"],
        on_event_callback=on_desktop_event,
        frames_dir_provider=lambda: logger.frames_dir
    )
    if state["mode"] == "DESKTOP":
        listener.start()

    class TradeEventPayload(BaseModel):
        type: str = "TRADE_MANUAL"
        action: str = ""
        price: float = 0.0
        contracts: int = 1
        voice_transcript: Optional[str] = ""
        drawing_data: Optional[Dict[str, Any]] = None
        frame_base64: Optional[str] = None

    class ModePayload(BaseModel):
        mode: str
        target_window_title: str = ""

    class StrategyModePayload(BaseModel):
        enabled: bool

    class KeyPayload(BaseModel):
        api_key: str

    class SwitchSessionPayload(BaseModel):
        date: str
        session_id: str

    class TerminalPayload(BaseModel):
        terminal_type: Optional[str] = None

    @app.get("/api/windows")
    def list_windows():
        return {"windows": get_system_windows()}

    @app.get("/api/gemini/status")
    def gemini_status():
        return analyzer.test_connection()

    @app.post("/api/gemini/key")
    def update_gemini_key(payload: KeyPayload):
        analyzer.update_key(payload.api_key)
        state["config"]["gemini_api_key"] = payload.api_key
        try:
            with open(state["config_path"], "w", encoding="utf-8") as f:
                json.dump(state["config"], f, indent=2, ensure_ascii=False)
        except Exception:
            pass
        return analyzer.test_connection()

    @app.get("/api/sessions")
    def get_sessions():
        return {"dates": logger.list_all_sessions()}

    @app.get("/api/terminal/config")
    def get_terminal_config():
        return {
            "terminal_type": state["config"].get("terminal_type", "ORCA"),
            "supported": ["ORCA", "WINDOWS", "WT", "NONE"]
        }

    @app.post("/api/terminal/config")
    def set_terminal_config(payload: TerminalPayload):
        if payload.terminal_type:
            state["config"]["terminal_type"] = payload.terminal_type.upper()
            try:
                with open(state["config_path"], "w", encoding="utf-8") as f:
                    json.dump(state["config"], f, indent=2, ensure_ascii=False)
            except Exception:
                pass
        return {"status": "ok", "terminal_type": state["config"].get("terminal_type", "ORCA")}

    @app.post("/api/terminal/open")
    def api_open_terminal(payload: Optional[TerminalPayload] = None):
        ttype = payload.terminal_type if payload else None
        open_session_terminal(logger.current_date, logger.session_id, ttype)
        return {
            "status": "ok",
            "session_id": logger.session_id,
            "date": logger.current_date,
            "terminal_type": ttype or state["config"].get("terminal_type", "ORCA")
        }

    @app.post("/api/sessions/new")
    async def create_new_session():
        pair_manager.reset()
        auditor.reset()
        new_id = logger.new_session()
        open_session_terminal(logger.current_date, new_id)
        await broadcast({
            "type": "SESSION_SWITCHED",
            "session_id": new_id,
            "date": logger.current_date,
            "summary": pair_manager.get_summary(),
            "recent_events": []
        })
        return {
            "status": "ok",
            "session_id": new_id,
            "date": logger.current_date,
            "dates": logger.list_all_sessions()
        }

    @app.post("/api/sessions/switch")
    async def switch_session(payload: SwitchSessionPayload):
        success = logger.load_session(payload.date, payload.session_id)
        if not success:
            return {"status": "error", "message": "Không tìm thấy phiên"}
        
        # Tái tính toán số điểm từ nhật ký phiên cũ
        pair_manager.reset()
        for ev in logger.events:
            act = ev.get("action", "").upper()
            pr = float(ev.get("price") or 0.0)
            if act in ("BUY", "SELL") and pr > 0:
                pair_manager.register_trade(
                    action=act,
                    price=pr,
                    timestamp=ev.get("timestamp", ""),
                    contracts=ev.get("contracts", 1)
                )

        summary = pair_manager.get_summary()
        open_session_terminal(payload.date, payload.session_id)
        await broadcast({
            "type": "SESSION_SWITCHED",
            "session_id": payload.session_id,
            "date": payload.date,
            "summary": summary,
            "recent_events": logger.events[-50:]
        })
        return {"status": "ok", "session_id": payload.session_id, "summary": summary}

    @app.delete("/api/sessions")
    async def delete_all_sessions():
        success = logger.delete_all_sessions()
        pair_manager.reset()
        auditor.reset()
        await broadcast({
            "type": "SESSION_SWITCHED",
            "session_id": logger.session_id,
            "date": logger.current_date,
            "summary": pair_manager.get_summary(),
            "recent_events": []
        })
        return {"status": "ok" if success else "error", "dates": logger.list_all_sessions()}

    @app.delete("/api/sessions/{date}/{session_id}")
    async def delete_session(date: str, session_id: str):
        was_current = (date == logger.current_date and session_id == logger.session_id)
        success = logger.delete_session(date, session_id)
        if success and was_current:
            pair_manager.reset()
            auditor.reset()
            await broadcast({
                "type": "SESSION_SWITCHED",
                "session_id": logger.session_id,
                "date": logger.current_date,
                "summary": pair_manager.get_summary(),
                "recent_events": []
            })
        return {"status": "ok" if success else "error", "dates": logger.list_all_sessions()}

    @app.get("/api/sessions/{date}/{session_id}/report/{report_type}")
    def get_session_report(date: str, session_id: str, report_type: str):
        filename = "session_review.html" if report_type.lower() == "html" else "session_review.pdf"
        file_path = os.path.join(sessions_root, date, session_id, filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Báo cáo không tồn tại")
        media_type = "text/html" if report_type.lower() == "html" else "application/pdf"
        return FileResponse(file_path, media_type=media_type, filename=filename)

    @app.get("/api/status")
    def get_status():
        return {
            "mode": state["mode"],
            "target_window_title": state["target_window_title"],
            "strategy_mode": state["strategy_mode"],
            "is_recording": state["is_recording"],
            "current_date": logger.current_date,
            "session_id": logger.session_id,
            "summary": pair_manager.get_summary(),
            "gemini_status": analyzer.test_connection(),
            "config": state["config"]
        }

    @app.post("/api/strategy-mode")
    async def toggle_strategy_mode(payload: StrategyModePayload):
        state["strategy_mode"] = payload.enabled
        auditor.enabled = payload.enabled
        await broadcast({"type": "STRATEGY_MODE_CHANGED", "enabled": payload.enabled})
        return {"status": "ok", "strategy_mode": state["strategy_mode"]}

    @app.post("/api/mode")
    async def set_mode(payload: ModePayload):
        state["mode"] = payload.mode
        if payload.target_window_title:
            state["target_window_title"] = payload.target_window_title
        
        if state["mode"] == "DESKTOP":
            listener.target_window_title = state["target_window_title"]
            listener.start()
        else:
            listener.stop()

        await broadcast({"type": "MODE_CHANGED", "mode": state["mode"], "target_window_title": state["target_window_title"]})
        return {"status": "ok", "mode": state["mode"], "target_window_title": state["target_window_title"]}

    @app.post("/api/trade")
    async def receive_trade(payload: TradeEventPayload):
        now_str = datetime.now().strftime("%H:%M:%S")
        warnings = auditor.audit(
            event_type=payload.type,
            action=payload.action,
            price=payload.price
        )

        trade_result = {}
        if payload.action.upper() in ("BUY", "SELL"):
            trade_result = pair_manager.register_trade(
                action=payload.action,
                price=payload.price,
                timestamp=now_str,
                contracts=payload.contracts
            )

        frame_path = None
        if payload.frame_base64:
            try:
                import base64
                b64_data = payload.frame_base64.split(",")[-1]
                img_data = base64.b64decode(b64_data)
                filename = f"tab_{datetime.now().strftime('%H%M%S_%f')[:10]}.png"
                filepath = os.path.join(logger.frames_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(img_data)
                frame_path = filepath
            except Exception:
                frame_path = None

        if not frame_path and state["mode"] == "DESKTOP":
            frame_path = listener.capture_screen()

        event_id = f"evt_{datetime.now().strftime('%H%M%S_%f')[:10]}"
        event = {
            "id": event_id,
            "type": payload.type,
            "action": payload.action.upper(),
            "price": payload.price,
            "contracts": payload.contracts,
            "timestamp": now_str,
            "voice_transcript": payload.voice_transcript,
            "drawing_data": payload.drawing_data,
            "warnings": warnings,
            "trade_result": trade_result,
            "frame_path": frame_path,
            "ai_thesis": "",
            "ai_pending": True
        }

        logger.log_event(event)
        summary = pair_manager.get_summary()

        await broadcast({
            "type": "TRADE_LOGGED",
            "event": event,
            "summary": summary
        })

        def run_trade_ai():
            res = analyzer.analyze_event(
                image_path=frame_path,
                audio_path=None,
                context={
                    "action": payload.action,
                    "price": payload.price,
                    "voice_transcript": payload.voice_transcript,
                    "warnings": warnings
                },
                session_id=logger.session_id
            )
            thesis = res.get("ai_thesis", "")
            if thesis:
                event["ai_thesis"] = thesis
                event["ai_pending"] = False
                logger.update_event(event_id, {"ai_thesis": thesis, "ai_pending": False})
                msg = {"type": "EVENT_UPDATED", "event": event, "summary": pair_manager.get_summary()}
                if main_loop and main_loop.is_running():
                    asyncio.run_coroutine_threadsafe(broadcast(msg), main_loop)

        import threading
        threading.Thread(target=run_trade_ai, daemon=True).start()

        return {"status": "ok", "event": event, "summary": summary}

    @app.post("/api/reject-setup")
    async def reject_setup(payload: Dict[str, Any]):
        now_str = datetime.now().strftime("%H:%M:%S")
        frame_path = None
        if payload.get("frame_base64"):
            try:
                import base64
                b64_data = payload["frame_base64"].split(",")[-1]
                img_data = base64.b64decode(b64_data)
                filename = f"reject_{datetime.now().strftime('%H%M%S_%f')[:10]}.png"
                filepath = os.path.join(logger.frames_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(img_data)
                frame_path = filepath
            except Exception:
                frame_path = None

        if not frame_path and state["mode"] == "DESKTOP":
            frame_path = listener.capture_screen()

        event_id = f"evt_{datetime.now().strftime('%H%M%S_%f')[:10]}"
        event = {
            "id": event_id,
            "type": "REJECTED_SETUP",
            "action": "REJECT",
            "timestamp": now_str,
            "reason": payload.get("reason", "Trader từ chối setup vì tín hiệu không đạt"),
            "voice_transcript": payload.get("voice_transcript", ""),
            "warnings": [],
            "frame_path": frame_path,
            "ai_thesis": "",
            "ai_pending": True
        }
        logger.log_event(event)
        await broadcast({
            "type": "REJECT_LOGGED",
            "event": event,
            "summary": pair_manager.get_summary()
        })

        def run_reject_ai():
            res = analyzer.analyze_event(
                image_path=frame_path,
                audio_path=None,
                context={
                    "action": "REJECT",
                    "reason": payload.get("reason", "Trader từ chối setup vì tín hiệu không đạt"),
                    "voice_transcript": payload.get("voice_transcript", ""),
                    "warnings": []
                },
                session_id=logger.session_id
            )
            thesis = res.get("ai_thesis", "")
            if thesis:
                event["ai_thesis"] = thesis
                event["ai_pending"] = False
                logger.update_event(event_id, {"ai_thesis": thesis, "ai_pending": False})
                msg = {"type": "EVENT_UPDATED", "event": event, "summary": pair_manager.get_summary()}
                if main_loop and main_loop.is_running():
                    asyncio.run_coroutine_threadsafe(broadcast(msg), main_loop)

        import threading
        threading.Thread(target=run_reject_ai, daemon=True).start()

        return {"status": "ok", "event": event}

    @app.post("/api/end-session")
    def end_session():
        summary = pair_manager.get_summary()
        reports = logger.export_reports(summary=summary)
        return {
            "status": "ended",
            "date": logger.current_date,
            "session_id": logger.session_id,
            "summary": summary,
            "reports": reports
        }

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        connected_clients.append(websocket)
        try:
            await websocket.send_text(json.dumps({
                "type": "INIT_STATE",
                "mode": state["mode"],
                "target_window_title": state["target_window_title"],
                "strategy_mode": state["strategy_mode"],
                "current_date": logger.current_date,
                "session_id": logger.session_id,
                "summary": pair_manager.get_summary(),
                "gemini_status": analyzer.test_connection(),
                "recent_events": logger.events[-50:]
            }, ensure_ascii=False))

            while True:
                data = await websocket.receive_text()
                msg = json.loads(data)
                if msg.get("type") in ("TRADE_OPEN", "TRADE_CLOSE", "DRAWING"):
                    now_str = datetime.now().strftime("%H:%M:%S")
                    action = msg.get("action", "").upper()
                    price = float(msg.get("price", 0.0))
                    warnings = auditor.audit(event_type=msg["type"], action=action, price=price)
                    trade_result = {}
                    if action in ("BUY", "SELL"):
                        trade_result = pair_manager.register_trade(action=action, price=price, timestamp=now_str)
                    
                    event = {
                        "type": msg["type"],
                        "action": action,
                        "price": price,
                        "timestamp": now_str,
                        "voice_transcript": msg.get("voice_transcript", ""),
                        "drawing_data": msg.get("drawing_data", {}),
                        "warnings": warnings,
                        "trade_result": trade_result
                    }
                    logger.log_event(event)
                    await broadcast({"type": "EVENT_LOGGED", "event": event, "summary": pair_manager.get_summary()})
        except WebSocketDisconnect:
            if websocket in connected_clients:
                connected_clients.remove(websocket)

    web_dir = os.path.join(os.path.dirname(config_path), "web")
    if os.path.exists(web_dir):
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")

    return app
