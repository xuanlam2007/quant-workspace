import asyncio
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.backtest_server import BacktestAiConfig, BacktestStrategy, BacktestTerminal, create_app


class BacktestEngineIsolationTests(unittest.TestCase):
    def make_app(self, folder, config):
        path = Path(folder) / "config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        with patch("engine.backtest_server.CliLearningAnalyzer") as factory:
            analyzer = factory.return_value
            analyzer._lock = threading.Lock()
            app = create_app(str(path), Path(folder) / "backtest.json")
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
            self.assertEqual(settings, {"provider": "AGY", "model": "observer"})
            self.assertEqual(json.loads(path.read_text())["ai_connection"]["provider"], "AGY")

    def test_login_terminal_is_independent_and_reserves_analysis_slot(self):
        with tempfile.TemporaryDirectory() as folder:
            app, analyzer, _, _ = self.make_app(folder, {})
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/terminal/open")
            with patch("engine.backtest_server.find_cli", return_value="codex.exe"), patch("engine.backtest_server.AccountTerminal.open") as opened:
                opened.side_effect = lambda provider, executable: {"status": "opened", "reserved": analyzer._lock.locked()}
                self.assertTrue(asyncio.run(endpoint(BacktestTerminal(provider="CODEX")))["reserved"])
                opened.assert_called_once_with("CODEX", "codex.exe")
                analyzer.invalidate.assert_called_once()
                self.assertFalse(analyzer._lock.locked())
                analyzer._lock.acquire()
                try:
                    with self.assertRaises(HTTPException) as error:
                        asyncio.run(endpoint(BacktestTerminal(provider="AGY")))
                    self.assertEqual(error.exception.status_code, 409)
                    self.assertEqual(opened.call_count, 1)
                finally:
                    analyzer._lock.release()

    def test_login_terminal_rejects_unknown_fields(self):
        for payload in ({"provider": "OTHER"}, {"provider": "CODEX", "command": "override"}, {"provider": "AGY", "terminal_type": "WINDOWS"}):
            with self.assertRaises(ValidationError):
                BacktestTerminal(**payload)

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

    def test_saved_gemini_config_and_catalog_are_independent(self):
        with tempfile.TemporaryDirectory() as folder:
            desired = {"provider": "AGY", "model": "preset-model"}
            app, analyzer, settings, _ = self.make_app(folder, {"backtest_ai_connection": desired})
            self.assertEqual(settings, desired)
            analyzer.catalog.return_value = {"models": [{"id": "preset-model"}]}
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/ai/catalog")
            self.assertEqual(asyncio.run(endpoint("AGY", True))["models"][0]["id"], "preset-model")
            analyzer.catalog.assert_called_once_with("AGY", True)

    def test_save_changes_only_backtest_and_invalidates_connection(self):
        with tempfile.TemporaryDirectory() as folder:
            original = {"ai_connection": {"provider": "CODEX", "model": "auditor"}, "strategy_documents": ["auditor.md"]}
            app, analyzer, _, path = self.make_app(folder, original)
            analyzer.catalog.return_value = {"models": [{"id": "gemini-preset"}]}
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/connection/config")
            asyncio.run(endpoint(BacktestAiConfig(provider="AGY", model="gemini-preset")))
            saved = json.loads((path.parent / "backtest.json").read_text(encoding="utf-8"))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), original)
            self.assertEqual(saved["backtest_ai_connection"]["provider"], "AGY")
            analyzer.configure.assert_called_once_with(saved["backtest_ai_connection"])
            self.assertFalse(analyzer._lock.locked())

    def test_unknown_model_effort_and_busy_configuration_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            app, analyzer, _, path = self.make_app(folder, {})
            analyzer.catalog.return_value = {"models": [{"id": "known", "efforts": [{"id": "low"}]}]}
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/connection/config")
            for payload in (BacktestAiConfig(provider="CODEX", model="missing"), BacktestAiConfig(provider="CODEX", model="known", effort="high")):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(endpoint(payload))
                self.assertEqual(error.exception.status_code, 409)
            analyzer._lock.acquire()
            try:
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(endpoint(BacktestAiConfig(provider="AGY")))
                self.assertEqual(error.exception.status_code, 409)
                self.assertEqual(json.loads(path.read_text()), {})
            finally:
                analyzer._lock.release()

    def test_import_strategy_uses_owned_private_path_and_preserves_auditor(self):
        with tempfile.TemporaryDirectory() as folder:
            app, _, _, path = self.make_app(folder, {"strategy_documents": ["auditor.md"]})
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/strategy")
            with patch("engine.backtest_server.STRATEGY_FOLDER", Path(folder) / "private"):
                asyncio.run(endpoint(BacktestStrategy(content="Fixture rules")))
            config = json.loads((path.parent / "backtest.json").read_text())
            self.assertEqual(json.loads(path.read_text())["strategy_documents"], ["auditor.md"])
            document = (path.parent / config["backtest_strategy_documents"][0]).resolve()
            self.assertEqual(document.parent, Path(folder) / "private")
            self.assertEqual(document.read_text(), "Fixture rules")

    def test_backtest_preferences_survive_later_auditor_save_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            app, _, _, path = self.make_app(folder, {})
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/connection/config")
            asyncio.run(endpoint(BacktestAiConfig(provider="AGY")))
            path.write_text(json.dumps({"ai_connection": {"provider": "CODEX"}}))
            with patch("engine.backtest_server.CliLearningAnalyzer") as factory:
                create_app(str(path), path.parent / "backtest.json")
            self.assertEqual(factory.call_args.args[0]["provider"], "AGY")

    def test_import_rejects_empty_oversized_and_server_owned_fields(self):
        for model, values in ((BacktestAiConfig, {"provider": "AGY", "connected": True}), (BacktestStrategy, {"content": "Rules", "path": "other.md"})):
            with self.assertRaises(ValidationError):
                model(**values)
        with tempfile.TemporaryDirectory() as folder:
            app, _, _, _ = self.make_app(folder, {})
            endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/strategy")
            for content in ("  ", "ả" * 40000):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(endpoint(BacktestStrategy(content=content)))
                self.assertEqual(error.exception.status_code, 422)

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
