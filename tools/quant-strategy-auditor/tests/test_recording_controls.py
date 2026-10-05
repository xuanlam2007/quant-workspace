import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from engine.core import SessionLogger
from engine.server import create_app, ModePayload, RecordingPayload, RecordingPreference, DecisionTestPayload, TradeEventPayload, RejectPayload


class FakeListener:
    def __init__(self, title, callback, frames):
        self.target_window_title = title
        self.target_window_id = 0
        self.generation = 0
        self.last_error = ""
        self.is_running = False
        self.frames = frames

    def start(self):
        self.is_running = True

    def stop(self):
        self.is_running = False

    def source(self):
        return {"id": self.target_window_id} if self.target_window_id else None

    def capture_screen(self):
        path = Path(self.frames()) / "test.png"
        path.write_bytes(b"test-window-frame")
        return str(path)


class RecordingControlTests(unittest.TestCase):
    def setUp(self):
        self.storage = tempfile.TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        self.root = Path(self.storage.name)
        logger = SessionLogger(str(self.root / "sessions"))
        logger.new_session()
        (self.root / "config.json").write_text(json.dumps({"mode": "DESKTOP", "target_window_title": "Old saved title", "auto_start_recording": True}), encoding="utf-8")
        listener = patch("engine.server.DesktopListener", FakeListener)
        listener.start()
        self.addCleanup(listener.stop)
        windows = patch("engine.server.window_details", side_effect=lambda handle: {"id": 42, "title": "Chart window"} if handle == 42 else None)
        windows.start()
        self.addCleanup(windows.stop)
        self.app = create_app(str(self.root / "config.json"))

    def endpoint(self, path, method="POST"):
        return next(route.endpoint for route in self.app.routes if route.path == path and method in getattr(route, "methods", []))

    def invoke(self, path, payload):
        return asyncio.run(self.endpoint(path)(payload))

    def status(self):
        return self.endpoint("/api/status", "GET")()

    def test_restart_with_old_title_does_not_start_or_select_window(self):
        state = self.status()
        self.assertFalse(state["is_recording"])
        self.assertEqual(state["target_window_id"], 0)
        with self.assertRaises(HTTPException) as error:
            self.invoke("/api/recording", RecordingPayload(action="start"))
        self.assertEqual(error.exception.status_code, 409)

    def test_selection_auto_starts_and_pause_resume_controls_saving(self):
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        self.assertTrue(self.status()["is_recording"])
        self.invoke("/api/recording", RecordingPayload(action="pause"))
        self.assertEqual(self.status()["recording_status"], "paused")
        for path, payload in [
            ("/api/trade", TradeEventPayload(action="BUY", price=1250)),
            ("/api/reject-setup", RejectPayload()),
            ("/api/decision-test", DecisionTestPayload(direction="LONG", price=1250, save=True)),
        ]:
            with self.assertRaises(HTTPException) as error:
                self.invoke(path, payload)
            self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.status()["recent_events"], [])
        self.assertEqual(list((self.root / "sessions").rglob("*.png")), [])
        self.invoke("/api/recording", RecordingPayload(action="resume"))
        self.assertTrue(self.status()["is_recording"])

    def test_disabled_auto_start_requires_explicit_start(self):
        self.invoke("/api/recording/preference", RecordingPreference(auto_start=False))
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        self.assertFalse(self.status()["is_recording"])
        self.invoke("/api/recording", RecordingPayload(action="start"))
        self.assertTrue(self.status()["is_recording"])
        self.invoke("/api/mode", ModePayload(mode="DESKTOP"))
        self.assertFalse(self.status()["is_recording"])

    def test_repeated_previews_do_not_log_or_consume_trade_limit(self):
        for _ in range(15):
            result = self.invoke("/api/decision-test", DecisionTestPayload(direction="SHORT", price=1250))
            self.assertFalse(result["saved"])
            self.assertNotIn("MAX_TRADES_WARNING", [item["type"] for item in result["warnings"]])
        self.assertEqual(self.status()["recent_events"], [])
        self.assertEqual(self.status()["summary"]["open_shorts_count"], 0)
        self.assertEqual(list((self.root / "sessions").rglob("*.png")), [])

    def test_saved_test_does_not_open_or_close_positions(self):
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        with patch("engine.server.GeminiMultimodalAnalyzer.analyze_event", return_value={"ai_thesis": "Test reviewed"}):
            result = self.invoke("/api/decision-test", DecisionTestPayload(direction="LONG", price=1250, save=True))
        self.assertTrue(result["saved"])
        self.assertEqual(result["event"]["type"], "DECISION_TEST")
        summary = self.status()["summary"]
        self.assertEqual(summary["open_longs_count"], 0)
        self.assertEqual(summary["total_closed_pairs"], 0)
        self.assertEqual(summary["total_net_points"], 0)


if __name__ == "__main__":
    unittest.main()
