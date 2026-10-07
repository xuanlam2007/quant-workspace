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
from engine.server import create_app, ModePayload, RecordingPayload, RecordingPreference, DecisionTestPayload, TradeEventPayload, RejectPayload, StrategyPayload, StrategyModePayload


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

        def create_listener(*args):
            self.listener = FakeListener(*args)
            return self.listener

        listener = patch("engine.server.DesktopListener", side_effect=create_listener)
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

    def test_stop_preserves_session_source_positions_and_evidence(self):
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        with patch("engine.server.GeminiMultimodalAnalyzer.analyze_event", return_value={"ai_thesis": "Reviewed"}):
            self.invoke("/api/trade", TradeEventPayload(action="BUY", price=1250, contracts=3))
            self.invoke("/api/trade", TradeEventPayload(action="SELL", price=1252, contracts=1))
        before = self.status()
        frames = {path: path.read_bytes() for path in (self.root / "sessions").rglob("*.png")}
        self.assertTrue(frames)
        stopped = self.invoke("/api/recording", RecordingPayload(action="stop"))
        self.assertEqual(stopped["recording_status"], "stopped")
        self.assertGreater(stopped["capture_generation"], before["capture_generation"])
        self.assertFalse(self.listener.is_running)
        after = self.status()
        self.assertFalse(after["is_recording"])
        for key in ("session_id", "current_date", "target_window_id", "target_window_title", "summary", "recent_events"):
            self.assertEqual(after[key], before[key])
        self.assertEqual(after["summary"]["open_longs_count"], 2)
        self.assertEqual(after["summary"]["total_closed_pairs"], 1)
        self.assertEqual(after["summary"]["total_net_points"], 1.55)
        for path, payload in [
            ("/api/trade", TradeEventPayload(action="SELL", price=1253)),
            ("/api/reject-setup", RejectPayload()),
            ("/api/decision-test", DecisionTestPayload(direction="LONG", price=1250, save=True)),
        ]:
            with self.assertRaises(HTTPException) as error:
                self.invoke(path, payload)
            self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.status()["recent_events"], before["recent_events"])
        self.assertEqual({path: path.read_bytes() for path in (self.root / "sessions").rglob("*.png")}, frames)
        self.invoke("/api/recording", RecordingPayload(action="start"))
        self.assertTrue(self.status()["is_recording"])
        self.assertTrue(self.listener.is_running)
        self.assertEqual(self.status()["session_id"], before["session_id"])
        self.assertEqual(self.status()["summary"], before["summary"])

    def test_stop_from_paused_or_stopped_never_restarts_listener(self):
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        self.invoke("/api/recording", RecordingPayload(action="pause"))
        for _ in range(2):
            self.invoke("/api/recording", RecordingPayload(action="stop"))
            self.assertEqual(self.status()["recording_status"], "stopped")
            self.assertFalse(self.listener.is_running)
            self.assertEqual(self.status()["target_window_id"], 42)

    def test_stale_browser_cleanup_cannot_interrupt_restarted_recording(self):
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        generation = self.status()["capture_generation"]
        self.invoke("/api/recording", RecordingPayload(action="stop"))
        self.invoke("/api/recording", RecordingPayload(action="start"))
        self.invoke("/api/recording", RecordingPayload(action="stop", browser_only=True, capture_generation=generation))
        self.assertTrue(self.status()["is_recording"])
        self.assertTrue(self.listener.is_running)

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

    def test_strategy_requires_user_rules_and_survives_restart(self):
        self.assertFalse(self.status()["strategy_mode"])
        with self.assertRaises(HTTPException) as error:
            self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        self.assertEqual(error.exception.status_code, 409)
        saved = self.invoke("/api/strategy", StrategyPayload(notes="  Only enter after my specified signal.  "))
        self.assertTrue(saved["strategy_mode"])
        self.assertEqual(saved["config"]["strategy_notes"], "Only enter after my specified signal.")
        self.app = create_app(str(self.root / "config.json"))
        self.assertTrue(self.status()["strategy_mode"])
        self.assertEqual(self.status()["config"]["strategy_notes"], saved["config"]["strategy_notes"])

    def test_legacy_defaults_are_not_treated_as_user_strategy(self):
        config_path = self.root / "config.json"
        config_path.write_text(json.dumps({"strategy_mode": True, "strategy_guardrails": {"session_start_time": "09:15:00", "session_cutoff_time": "10:00:00", "optimal_window_seconds_before": 5, "optimal_window_seconds_after": 3, "max_trades_per_day": 10, "fee_per_closed_pair": 0.75}}), encoding="utf-8")
        self.app = create_app(str(config_path))
        self.assertFalse(self.status()["strategy_mode"])
        self.assertEqual(self.status()["config"]["strategy_guardrails"], {"fee_per_closed_pair": 0.75})
        result = self.invoke("/api/decision-test", DecisionTestPayload(direction="LONG", price=1250))
        self.assertEqual(result["warnings"], [])

    def test_clearing_strategy_keeps_recording_and_historical_strategy(self):
        notes = "Wait for my specified signal."
        self.invoke("/api/strategy", StrategyPayload(notes=notes))
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        with patch("engine.server.GeminiMultimodalAnalyzer.analyze_event", return_value={"ai_thesis": "Reviewed"}):
            saved = self.invoke("/api/decision-test", DecisionTestPayload(direction="LONG", price=1250, save=True))
        self.assertEqual(saved["event"]["strategy"]["notes"], notes)
        self.invoke("/api/strategy", StrategyPayload(notes=""))
        state = self.status()
        self.assertFalse(state["strategy_mode"])
        self.assertTrue(state["is_recording"])
        self.assertEqual(state["recent_events"][-1]["strategy"]["notes"], notes)
        self.assertEqual(state["config"]["strategy_notes"], "")

    def test_strategy_save_failure_preserves_active_rules(self):
        self.invoke("/api/strategy", StrategyPayload(notes="My original rules."))
        with patch("engine.server.json.dump", side_effect=OSError("Preference storage unavailable")):
            with self.assertRaises(HTTPException) as error:
                self.invoke("/api/strategy", StrategyPayload(notes="Replacement rules."))
        self.assertEqual(error.exception.status_code, 500)
        state = self.status()
        self.assertTrue(state["strategy_mode"])
        self.assertEqual(state["config"]["strategy_notes"], "My original rules.")
        saved_config = json.loads((self.root / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(saved_config["strategy_notes"], "My original rules.")


if __name__ == "__main__":
    unittest.main()
