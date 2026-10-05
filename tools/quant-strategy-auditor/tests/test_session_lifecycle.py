import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.core import SessionLogger, TradePairManager


class SessionLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.storage = tempfile.TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        self.root = Path(self.storage.name) / "sessions"

    def test_loading_an_empty_workspace_does_not_create_a_session(self):
        for _ in range(3):
            logger = SessionLogger(str(self.root))
            self.assertEqual(logger.session_id, "")
            self.assertEqual(logger.list_all_sessions(), [])
        self.assertFalse(self.root.exists())

    def test_restart_restores_selected_session_instead_of_latest(self):
        logger = SessionLogger(str(self.root))
        original = logger.new_session()
        date = logger.current_date
        logger.log_event({"type": "TRADE_MANUAL", "action": "BUY", "price": 1250, "timestamp": "09:16:00"})
        logger.new_session()
        logger.load_session(date, original)
        for _ in range(3):
            restored = SessionLogger(str(self.root))
            self.assertEqual(restored.session_id, original)
            self.assertEqual(restored.events[0]["price"], 1250)
            self.assertEqual(sum(len(group["sessions"]) for group in restored.list_all_sessions()), 2)

    def test_explicit_session_ids_do_not_collide(self):
        logger = SessionLogger(str(self.root))
        identifiers = {logger.new_session() for _ in range(5)}
        self.assertEqual(len(identifiers), 5)
        self.assertEqual(len(logger.list_all_sessions()[0]["sessions"]), 5)

    def test_legacy_sessions_are_restored_without_new_folders(self):
        folder = self.root / "2026-10-01" / "session_091500"
        folder.mkdir(parents=True)
        (folder / "events.jsonl").write_text(json.dumps({"type": "DRAWING", "timestamp": "09:15:00"}) + "\n", encoding="utf-8")
        logger = SessionLogger(str(self.root))
        self.assertEqual(logger.session_id, "session_091500")
        self.assertEqual(logger.events[0]["id"], "legacy_0")
        self.assertEqual([entry.name for entry in folder.parent.iterdir()], ["session_091500"])

    def test_deleting_active_session_returns_to_empty_state(self):
        logger = SessionLogger(str(self.root))
        session_id = logger.new_session()
        self.assertTrue(logger.delete_session(logger.current_date, session_id))
        self.assertEqual(logger.session_id, "")
        self.assertEqual(SessionLogger(str(self.root)).list_all_sessions(), [])

    def test_clear_history_does_not_create_a_replacement(self):
        logger = SessionLogger(str(self.root))
        logger.new_session()
        logger.new_session()
        self.assertTrue(logger.delete_all_sessions())
        self.assertEqual(logger.session_id, "")
        restored = SessionLogger(str(self.root))
        self.assertEqual(restored.session_id, "")
        self.assertEqual(restored.list_all_sessions(), [])

    def test_late_ai_update_stays_in_original_session(self):
        logger = SessionLogger(str(self.root))
        original = logger.new_session()
        date = logger.current_date
        event = {"type": "TRADE_MANUAL", "timestamp": "09:16:00", "ai_pending": True}
        logger.log_event(event)
        current = logger.new_session()
        self.assertTrue(logger.update_event(event["id"], {"ai_pending": False, "ai_thesis": "Reviewed"}, date, original))
        self.assertEqual(logger.session_id, current)
        self.assertEqual(logger.events, [])
        logger.load_session(date, original)
        self.assertEqual(logger.events[0]["ai_thesis"], "Reviewed")

    def test_partial_contract_closes_preserve_remaining_position(self):
        manager = TradePairManager()
        manager.register_trade("BUY", 1250, "09:16:00", 3)
        manager.register_trade("SELL", 1252, "09:17:00", 1)
        summary = manager.get_summary()
        self.assertEqual(summary["open_longs_count"], 2)
        self.assertEqual(summary["total_closed_pairs"], 1)
        self.assertEqual(summary["total_net_points"], 1.55)
        manager.register_trade("SELL", 1253, "09:18:00", 2)
        summary = manager.get_summary()
        self.assertEqual(summary["open_longs_count"], 0)
        self.assertEqual(summary["total_closed_pairs"], 3)
        self.assertEqual(summary["total_net_points"], 6.65)


if __name__ == "__main__":
    unittest.main()
