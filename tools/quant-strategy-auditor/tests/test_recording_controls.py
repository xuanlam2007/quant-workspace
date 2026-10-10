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
from engine.server import create_app, ModePayload, RecordingPayload, RecordingPreference, ObservationPayload, TradeEventPayload, StrategyModePayload


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
            ("/api/observation", ObservationPayload()),
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
        with patch("engine.server.CliLearningAnalyzer.analyze_event", return_value={"ai_thesis": "Reviewed"}):
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
            ("/api/observation", ObservationPayload()),
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

    def test_simulation_and_strategy_editing_are_outside_recorder_scope(self):
        routes = [route.path for route in self.app.routes]
        for path in ("/api/decision-test", "/api/reject-setup", "/api/strategy"):
            self.assertNotIn(path, routes)

    def test_recorded_observation_does_not_open_or_close_positions(self):
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        result = self.invoke("/api/observation", ObservationPayload())
        self.assertEqual(result["event"]["type"], "OBSERVATION")
        summary = self.status()["summary"]
        self.assertEqual(summary["open_longs_count"], 0)
        self.assertEqual(summary["total_closed_pairs"], 0)
        self.assertEqual(summary["total_net_points"], 0)

    def add_strategy(self, notes):
        path = self.root / "Strategy_01.md"
        path.write_text(notes, encoding="utf-8")
        config_path = self.root / "config.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["strategy_documents"] = [path.name]
        config_path.write_text(json.dumps(config), encoding="utf-8")
        self.app = create_app(str(config_path))

    def test_strategy_requires_document_and_survives_restart(self):
        self.assertFalse(self.status()["strategy_mode"])
        with self.assertRaises(HTTPException) as error:
            self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        self.assertEqual(error.exception.status_code, 409)
        self.add_strategy("Only enter after my specified signal.")
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        self.app = create_app(str(self.root / "config.json"))
        self.assertTrue(self.status()["strategy_mode"])
        self.assertEqual(self.status()["strategy_documents"], ["Strategy_01.md"])

    def test_legacy_defaults_are_not_treated_as_user_strategy(self):
        config_path = self.root / "config.json"
        config_path.write_text(json.dumps({"strategy_mode": True, "strategy_guardrails": {"session_start_time": "08:00:00", "session_cutoff_time": "16:00:00", "optimal_window_seconds_before": 2, "optimal_window_seconds_after": 1, "max_trades_per_day": 4, "fee_per_closed_pair": 0.75}}), encoding="utf-8")
        self.app = create_app(str(config_path))
        self.assertFalse(self.status()["strategy_mode"])
        self.assertEqual(self.status()["config"]["strategy_guardrails"], {"fee_per_closed_pair": 0.75})
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        result = self.invoke("/api/observation", ObservationPayload())
        self.assertEqual(result["event"]["warnings"], [])

    def test_disabling_reference_keeps_recording_and_historical_document(self):
        notes = "Wait for my specified signal."
        self.add_strategy(notes)
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        saved = self.invoke("/api/observation", ObservationPayload())
        self.assertEqual(saved["event"]["strategy"]["documents"][0]["content"], notes)
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=False))
        state = self.status()
        self.assertFalse(state["strategy_mode"])
        self.assertTrue(state["is_recording"])
        self.assertEqual(state["recent_events"][-1]["strategy"]["documents"][0]["content"], notes)

    def test_strategy_save_failure_preserves_active_reference(self):
        self.add_strategy("My original rules.")
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        with patch("engine.server.json.dump", side_effect=OSError("Preference storage unavailable")):
            with self.assertRaises(HTTPException) as error:
                self.invoke("/api/strategy-mode", StrategyModePayload(enabled=False))
        self.assertEqual(error.exception.status_code, 500)
        self.assertTrue(self.status()["strategy_mode"])
        saved_config = json.loads((self.root / "config.json").read_text(encoding="utf-8"))
        self.assertTrue(saved_config["strategy_mode"])


if __name__ == "__main__":
    unittest.main()
