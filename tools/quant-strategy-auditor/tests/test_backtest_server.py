import asyncio
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.backtest_server import create_app


class BacktestEngineIsolationTests(unittest.TestCase):
    def make_app(self, folder, config):
        path = Path(folder) / "config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        with patch("engine.backtest_server.CliLearningAnalyzer") as factory:
            analyzer = factory.return_value
            analyzer._lock = threading.Lock()
            app = create_app(str(path))
            return app, analyzer, factory.call_args.args[0], path

    def test_no_auditor_routes_sessions_or_lifecycle_workers(self):
        with tempfile.TemporaryDirectory() as folder:
            app, _, settings, path = self.make_app(folder, {"ai_connection": {"provider": "AGY", "model": "observer"}})
            routes = {route.path: route for route in app.routes}
            self.assertEqual(routes["/api/health"].endpoint(), {"engine": "backtest", "protocol_version": 1})
            self.assertIn("/api/backtest/analyze", routes)
            self.assertIn("/api/backtest/connection/test", routes)
            self.assertNotIn("/api/status", routes)
            self.assertNotIn("/api/recording", routes)
            self.assertNotIn("/ws", routes)
            self.assertFalse(app.router.on_startup)
            self.assertEqual(list(Path(folder).iterdir()), [path])
            self.assertEqual(settings, {"provider": "CODEX"})
            self.assertEqual(json.loads(path.read_text())["ai_connection"]["provider"], "AGY")

    def test_private_backtest_settings_take_priority(self):
        with tempfile.TemporaryDirectory() as folder:
            desired = {"provider": "CODEX", "model": "test-model", "effort": "low"}
            _, _, settings, _ = self.make_app(folder, {"ai_connection": {"provider": "CODEX", "model": "observer"}, "backtest_ai_connection": desired})
            self.assertEqual(settings, desired)

    def test_saved_codex_config_is_usable_without_auditor(self):
        with tempfile.TemporaryDirectory() as folder:
            desired = {"provider": "CODEX", "model": "test-model"}
            _, _, settings, _ = self.make_app(folder, {"ai_connection": desired})
            self.assertEqual(settings, desired)

    def test_busy_analysis_blocks_connection_check(self):
        with tempfile.TemporaryDirectory() as folder:
            app, analyzer, _, _ = self.make_app(folder, {})
            route = next(route for route in app.routes if route.path == "/api/backtest/connection/test")
            analyzer._lock.acquire()
            try:
                with self.assertRaises(HTTPException) as caught:
                    asyncio.run(route.endpoint())
                self.assertEqual(caught.exception.status_code, 409)
                analyzer.test_connection.assert_not_called()
            finally:
                analyzer._lock.release()


if __name__ == "__main__":
    unittest.main()
