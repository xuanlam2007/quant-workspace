import asyncio
import base64
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.backtest_bridge import BacktestDecision, BacktestFrame, register_backtest
from engine.cli_analyzer import CliLearningAnalyzer
from engine.learning_context import build_learning_prompt


def frame(**changes):
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + (400).to_bytes(4, "big") + (300).to_bytes(4, "big")
    value = {"symbol": "VN30F1M", "cutoff": 60, "granularity": "1m", "bars": [{"time": 0, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 10}], "image": "data:image/png;base64," + base64.b64encode(png).decode(), "drawings": [], "position": None, "orders": [], "teaching": "", "history": []}
    value.update(changes)
    return BacktestFrame(**value)


def hold(**changes):
    result = {"action": "HOLD", "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "Chưa có setup", "question": "", "drawings": []}
    result.update(changes)
    return result


class BacktestSchemaTests(unittest.TestCase):
    def test_unfinished_m1_is_not_visible(self):
        with self.assertRaises(ValidationError):
            frame(cutoff=55)
        self.assertEqual(frame(cutoff=55, granularity="1s").bars[0].time, 0)

    def test_future_context_is_rejected(self):
        with self.assertRaises(ValidationError):
            frame(position={"side": "LONG", "price": 100, "time": 61})
        with self.assertRaises(ValidationError):
            frame(history=[{"cutoff": 61, "action": "HOLD", "reason": "future"}])
        with self.assertRaises(ValidationError):
            frame(drawings=[{"id": "line", "tool": "HorizontalLine", "points": [{"timestamp": 60, "price": 100}], "label": "future"}])

    def test_stop_limit_requires_both_prices(self):
        with self.assertRaises(ValidationError):
            BacktestDecision(**hold(action="OPEN_LONG", order_type="STOP_LIMIT", stop_price=105))
        self.assertEqual(BacktestDecision(**hold(action="OPEN_LONG", order_type="STOP_LIMIT", stop_price=105, limit_price=106)).limit_price, 106)

    def test_invalid_chart_range_and_drawing_count_are_rejected(self):
        with self.assertRaises(ValidationError):
            frame(bars=[{"time": 0, "open": 100, "high": 90, "low": 80, "close": 100, "volume": 1}])
        with self.assertRaises(ValidationError):
            frame(drawings=[{"id": "line", "tool": "TrendLine", "points": [{"timestamp": 0, "price": 100}], "label": "missing point"}])

    def test_auditor_orchestrator_does_not_force_strategy_evaluation(self):
        prompt = build_learning_prompt({"strategy": {"enabled": False}})
        self.assertIn("Do not evaluate against a strategy", prompt)
        self.assertIn("Say that you do not know", prompt)
        self.assertIn("Adapter instructions", prompt)


class BacktestRouteTests(unittest.TestCase):
    def setUp(self):
        self.analyzer = CliLearningAnalyzer({"provider": "CODEX", "model": "test-model", "effort": "low"})
        self.analyzer.connection = {"connected": True}
        self.analyzer._catalog_revision = 1
        app = FastAPI()
        register_backtest(app, self.analyzer, {}, Path("config.json"))
        self.endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/analyze")

    def test_public_clone_without_adapter_makes_no_provider_request(self):
        with patch("engine.backtest_bridge.Path.is_file", return_value=False):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
        self.assertEqual(error.exception.status_code, 503)

    def test_gemini_uses_same_admission_and_decision_validation(self):
        self.analyzer.configure({"provider": "AGY", "model": "gemini-preset"})
        self.analyzer.connection = {"connected": True}
        result = self.run_mock(hold())
        self.assertEqual(result["model"]["provider"], "AGY")
        self.assertEqual(result["decision"]["action"], "HOLD")

    def test_backtest_strategy_does_not_override_auditor_reference(self):
        config = {"strategy_documents": ["auditor.md"], "backtest_strategy_documents": ["backtest.md"]}
        app = FastAPI()
        register_backtest(app, self.analyzer, config, Path("config.json"))
        endpoint = next(route.endpoint for route in app.routes if route.path == "/api/backtest/status")
        with patch("engine.backtest_bridge.load_strategy_documents", return_value=([], [])) as load:
            endpoint()
        self.assertEqual(load.call_args.args[0]["strategy_documents"], ["backtest.md"])
        self.assertEqual(config["strategy_documents"], ["auditor.md"])

    def test_busy_provider_does_not_queue(self):
        self.analyzer._lock.acquire()
        try:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
            self.assertEqual(error.exception.status_code, 409)
        finally:
            self.analyzer._lock.release()

    def run_mock(self, output, mutate=None):
        def analyze(analyzer, context, documents, image_path, schema):
            self.assertTrue(image_path.exists())
            self.assertTrue(analyzer._lock.locked())
            self.assertNotIn("image", context)
            self.assertEqual(schema["title"], "BacktestDecision")
            if mutate:
                mutate()
            return output
        module = SimpleNamespace(analyze=analyze)
        documents = [{"name": "test.md", "content": "fixture rule", "sha256": "v1"}]
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_strategy_documents", return_value=(documents, [])), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            return asyncio.run(self.endpoint(frame()))

    def test_mock_adapter_receives_chart_and_backtest_schema(self):
        result = self.run_mock(hold())
        self.assertEqual(result["cutoff"], 60)
        self.assertEqual(result["strategy_versions"], ["v1"])

    def test_changed_account_result_is_discarded(self):
        with self.assertRaises(HTTPException) as error:
            self.run_mock(hold(), lambda: setattr(self.analyzer, "_catalog_revision", 2))
        self.assertEqual(error.exception.status_code, 409)

    def test_future_ai_drawing_is_discarded(self):
        with self.assertRaises(HTTPException) as error:
            self.run_mock(hold(drawings=[{"id": "future", "tool": "HorizontalLine", "points": [{"timestamp": 60, "price": 100}], "label": "future"}]))
        self.assertEqual(error.exception.status_code, 422)

    def test_auditor_starting_after_preflight_prevents_adapter_dispatch(self):
        documents = [{"name": "test.md", "content": "fixture rule", "sha256": "v1"}]

        def load_documents(*_):
            self.assertTrue(self.analyzer._lock.acquire(blocking=False))
            return documents, []

        try:
            with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_strategy_documents", side_effect=load_documents), patch("engine.backtest_bridge.importlib.util.spec_from_file_location") as load_adapter:
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(self.endpoint(frame()))
                self.assertEqual(error.exception.status_code, 409)
                load_adapter.assert_not_called()
        finally:
            if self.analyzer._lock.locked():
                self.analyzer._lock.release()

    def test_backtest_and_auditor_use_the_same_atomic_slot(self):
        attempted = threading.Event()
        entered = threading.Event()
        order = []

        def auditor_observation():
            attempted.set()
            with self.analyzer._analysis_slot():
                order.append("auditor")
                entered.set()

        thread = threading.Thread(target=auditor_observation)

        def during_adapter():
            thread.start()
            self.assertTrue(attempted.wait(2))
            self.assertFalse(entered.is_set())
            order.append("backtest")

        try:
            self.run_mock(hold(), during_adapter)
        finally:
            if thread.ident is not None:
                thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertTrue(entered.is_set())
        self.assertEqual(order, ["backtest", "auditor"])
        self.assertFalse(self.analyzer._lock.locked())

    def test_adapter_failure_releases_the_slot_for_the_next_request(self):
        def fail():
            raise RuntimeError("Fixture provider failure")

        with self.assertRaises(HTTPException) as error:
            self.run_mock(hold(), fail)
        self.assertEqual(error.exception.status_code, 502)
        self.assertFalse(self.analyzer._lock.locked())
        self.assertEqual(self.run_mock(hold())["decision"]["action"], "HOLD")

    def test_connection_change_before_admission_never_loads_the_adapter(self):
        documents = [{"name": "test.md", "content": "fixture rule", "sha256": "v1"}]
        calls = 0

        def load_documents(*_):
            nonlocal calls
            calls += 1
            if calls == 2:
                self.analyzer.connection = {"connected": False}
            return documents, []

        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_strategy_documents", side_effect=load_documents), patch("engine.backtest_bridge.importlib.util.spec_from_file_location") as load_adapter:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
            self.assertEqual(error.exception.status_code, 409)
            load_adapter.assert_not_called()
        self.assertFalse(self.analyzer._lock.locked())

    def test_cancelled_route_keeps_slot_and_image_until_worker_finishes(self):
        started = threading.Event()
        release = threading.Event()
        images = []
        documents = [{"name": "test.md", "content": "fixture rule", "sha256": "v1"}]

        def analyze(*args):
            images.append(args[3])
            started.set()
            if not release.wait(5):
                raise RuntimeError("Fixture worker was not released")
            return hold()

        async def cancel_request():
            request = asyncio.create_task(self.endpoint(frame()))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                with self.assertRaises(HTTPException) as busy_error:
                    await self.endpoint(frame())
                self.assertEqual(busy_error.exception.status_code, 409)
                request.cancel()
                await asyncio.sleep(0)
                self.assertTrue(self.analyzer._lock.locked())
                self.assertTrue(images[0].exists())
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await request
            finally:
                release.set()
                if not request.done():
                    try:
                        await request
                    except asyncio.CancelledError:
                        pass

        module = SimpleNamespace(analyze=analyze)
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_strategy_documents", return_value=(documents, [])), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            asyncio.run(cancel_request())
        self.assertFalse(self.analyzer._lock.locked())
        self.assertFalse(images[0].exists())
