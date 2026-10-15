import asyncio
import base64
import sys
import threading
import unittest
import os
import time
import subprocess
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.backtest_bridge import BacktestDecision, BacktestFrame, CHART_TOOLS, ReplayIndicator, ToolOwner, ToolSync, ToolAck, register_backtest
from engine.quant_mcp_stdio import exchange
from engine.cli_analyzer import CliLearningAnalyzer
from engine.learning_context import build_learning_prompt
from engine.cli_diagnostics import CliRequestError


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
    def test_manual_quantity_and_conditional_metadata_remain_strict(self):
        order = {"id": "order-1", "side": "BUY", "purpose": "OPEN", "type": "STOP_LIMIT", "stop": 101, "limit": 102, "submitted": 0, "triggered": None, "status": "waiting", "filled": None, "price": None, "quantity": 3, "strategy": "trailing", "trailing": {"amount": 1, "spread": 1, "anchor": 100}}
        value = frame(orders=[order], position={"side": "LONG", "price": 100, "time": 0, "quantity": 3})
        self.assertEqual(value.orders[0].quantity, 3)
        self.assertEqual(value.position.quantity, 3)
        for quantity in (0, 1001, 1.5):
            with self.assertRaises(ValidationError):
                frame(orders=[{**order, "quantity": quantity}])
            with self.assertRaises(ValidationError):
                frame(position={"side": "LONG", "price": 100, "time": 0, "quantity": quantity})
        with self.assertRaises(ValidationError):
            frame(orders=[{**order, "account": "broker"}])
        with self.assertRaises(ValidationError):
            frame(orders=[{**order, "trailing": {**order["trailing"], "command": "shell"}}])

    def test_every_registered_drawing_tool_has_strict_anchor_count(self):
        for tool, count in CHART_TOOLS["drawings"].items():
            drawing = {"id": "fixture", "tool": tool, "points": [{"timestamp": i, "price": 100 + i} for i in range(count)], "label": "Fixture"}
            self.assertEqual(BacktestDecision(**hold(drawings=[drawing])).drawings[0].tool, tool)
            self.assertEqual(frame(drawings=[drawing]).drawings[0].tool, tool)
            with self.assertRaises(ValidationError):
                BacktestDecision(**hold(drawings=[{**drawing, "points": []}]))

    def test_all_registered_indicators_and_typed_inputs(self):
        for definition in CHART_TOOLS["indicators"]:
            self.assertEqual(ReplayIndicator(id="fixture", name=definition["name"], inputs=[], visible=True, operation="upsert").name, definition["name"])
        indicator = {"id": "rsi", "name": "Relative Strength Index", "inputs": [{"id": "length", "value": 14}], "visible": True, "operation": "upsert"}
        self.assertEqual(BacktestDecision(**hold(indicators=[indicator])).indicators[0].inputs[0].value, 14)
        for changes in ({"name": "Unknown"}, {"shell": "forbidden"}, {"inputs": [{"id": "length", "value": "14"}]}, {"inputs": [{"id": "length", "value": True}]}, {"inputs": [{"id": "length", "value": 0}]}, {"inputs": [{"id": "length", "value": float("inf")}]}, {"inputs": [{"id": "length", "value": 2.5}]}, {"inputs": [{"id": "length", "value": 14}, {"id": "length", "value": 15}]}, {"inputs": [{"id": "smoothingLine", "value": "OTHER"}]}):
            with self.assertRaises(ValidationError):
                ReplayIndicator(**{**indicator, **changes})

    def test_chart_tools_accept_zones_and_annotations_with_strict_points(self):
        for tool in ("Arrow", "Rectangle", "FibRetracement", "Text", "HorizontalRay", "VerticalLine", "CrossLine"):
            one_point = tool in ("Text", "HorizontalRay", "VerticalLine", "CrossLine")
            points = [{"timestamp": 0, "price": 100}] + ([] if one_point else [{"timestamp": 30, "price": 101}])
            drawing = {"id": "setup", "tool": tool, "points": points, "label": "Setup"}
            self.assertEqual(frame(drawings=[drawing]).drawings[0].tool, tool)
            self.assertEqual(BacktestDecision(**hold(drawings=[drawing])).drawings[0].tool, tool)
            with self.assertRaises(ValidationError):
                frame(drawings=[{**drawing, "shell": "forbidden"}])
            with self.assertRaises(ValidationError):
                frame(drawings=[{**drawing, "points": [{"timestamp": 60, "price": 100}] + points[1:]}])
        with self.assertRaises(ValidationError):
            frame(drawings=[{"id": "bad", "tool": "Rectangle", "points": [{"timestamp": 0, "price": 100}], "label": ""}])

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
        self.sync = next(route.endpoint for route in app.routes if route.path == "/api/backtest/tools/sync")
        self.reset = next(route.endpoint for route in app.routes if route.path == "/api/backtest/tools/reset")
        self.ack = next(route.endpoint for route in app.routes if route.path == "/api/backtest/tools/ack")

    def test_missing_all_adapters_makes_no_provider_request(self):
        with patch("engine.backtest_bridge.Path.is_file", return_value=False):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
        self.assertEqual(error.exception.status_code, 503)

    def test_no_markdown_still_allows_trading(self):
        output = hold(action="OPEN_LONG", reason="AI-generated price-action setup")
        module = SimpleNamespace(analyze=lambda *args: output)
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", return_value=([], [])), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            result = asyncio.run(self.endpoint(frame()))
        self.assertEqual(result["decision"]["action"], "OPEN_LONG")
        self.assertEqual(result["strategy_versions"], [])

    def test_safe_cli_failure_reaches_notification_without_applying_decision(self):
        failure = CliRequestError("structured_output", "finish")
        module = SimpleNamespace(analyze=lambda *args: (_ for _ in ()).throw(failure))
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", return_value=([], [])), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(error.exception.detail, failure.safe_message)
        self.assertFalse(self.analyzer._lock.locked())

    def test_provider_timeout_returns_504_without_fabricating_a_decision_or_retrying(self):
        self.analyzer.configure({"provider": "AGY", "model": "gemini-preset"})
        self.analyzer.connection = {"connected": True}
        payload = self.recovery_frame()
        calls = []
        def fail():
            calls.append(True)
            raise subprocess.TimeoutExpired(["private-cli", "secret-token"], 120, output="private strategy")
        with self.assertRaises(HTTPException) as error:
            self.run_mock(hold(), payload=payload, mutate=fail)
        self.assertEqual(error.exception.status_code, 504)
        self.assertIn("AGY", error.exception.detail)
        self.assertIn("120", error.exception.detail)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.recover(payload), {"command": None})
        self.assertFalse(self.analyzer._lock.locked())
        self.assertIsNone(self.analyzer._backtest_mcp)
        for secret in ("private-cli", "secret-token", "private strategy"):
            self.assertNotIn(secret, error.exception.detail)

    def test_changed_strategy_during_request_discards_result(self):
        module = SimpleNamespace(analyze=lambda *args: hold())
        initial = [{"name": "rule.md", "content": "fixture", "sha256": "v1"}]
        changed = [{"name": "rule.md", "content": "changed", "sha256": "v2"}]
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", side_effect=[(initial, []), (initial, []), (changed, [])]), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
        self.assertEqual(error.exception.status_code, 409)

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
        with patch("engine.backtest_bridge.load_backtest_documents", return_value=([], [])) as load:
            endpoint()
        self.assertEqual(load.call_args.args[0]["backtest_strategy_documents"], ["backtest.md"])
        self.assertEqual(config["strategy_documents"], ["auditor.md"])

    def test_busy_provider_does_not_queue(self):
        self.analyzer._lock.acquire()
        try:
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self.endpoint(frame()))
            self.assertEqual(error.exception.status_code, 409)
        finally:
            self.analyzer._lock.release()

    def run_mock(self, output, mutate=None, payload=None, execute=None):
        def analyze(analyzer, context, documents, image_path, schema):
            self.assertTrue(image_path.exists())
            self.assertTrue(analyzer._lock.locked())
            self.assertNotIn("image", context)
            self.assertEqual(schema["title"], "BacktestDecision")
            if analyzer.__dict__.get("_backtest_mcp"):
                with patch.dict(os.environ, analyzer._backtest_mcp):
                    exchange("/call", {"name": "get_chart_state", "arguments": {}})
            if mutate:
                mutate()
            return output
        module = SimpleNamespace(analyze=analyze)
        documents = [{"name": "test.md", "content": "fixture rule", "sha256": "v1"}]
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", return_value=(documents, [])), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            operation = self.endpoint(payload or frame())
            return asyncio.run(execute(operation) if execute else operation)

    def recovery_frame(self, **changes):
        return frame(client_id=str(uuid.uuid4()), drawings=[{"id": "support", "tool": "HorizontalLine", "points": [{"timestamp": 0, "price": 100}], "label": "Fixture"}], indicators=[{"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert", "status": "ready"}], **changes)

    def recover(self, payload):
        with patch("engine.backtest_bridge.load_backtest_documents", return_value=([{"sha256": "v1"}], [])):
            return self.sync(ToolSync(client_id=payload.client_id, frame=payload))

    def test_completed_result_recovery_is_owner_scoped_and_does_not_rerun_adapter(self):
        payload = self.recovery_frame()
        result = self.run_mock(hold(), payload=payload)
        with patch("engine.backtest_bridge.importlib.util.spec_from_file_location") as adapter:
            self.assertEqual(self.recover(payload), {"command": None, "analysis": result})
            self.assertEqual(self.recover(payload), {"command": None, "analysis": result})
            adapter.assert_not_called()
        other = payload.model_copy(update={"client_id": str(uuid.uuid4())})
        self.assertEqual(self.recover(other), {"command": None})
        with self.assertRaises(HTTPException) as error:
            self.recover(payload.model_copy(update={"symbol": "OTHER"}))
        self.assertEqual(error.exception.status_code, 409)

    def test_117_second_success_survives_sync_and_final_validation_after_ack(self):
        payload = self.recovery_frame()
        clock = [0.0]
        real_monotonic = time.monotonic
        accepted = []
        def acknowledge_then_finish_late():
            def apply():
                with patch.dict(os.environ, self.analyzer._backtest_mcp):
                    exchange("/call", {"name": "apply_chart", "arguments": {}})
            worker = threading.Thread(target=apply)
            worker.start()
            command = None
            deadline = real_monotonic() + 2
            while command is None and real_monotonic() < deadline:
                command = self.sync(ToolSync(client_id=payload.client_id, frame=payload))["command"]
            self.assertIsNotNone(command)
            accepted.append(command["id"])
            self.ack(ToolAck(client_id=payload.client_id, frame=payload, command_id=command["id"], error=""))
            worker.join(2)
            self.assertFalse(worker.is_alive())
            clock[0] = 117.203
            self.assertEqual(self.sync(ToolSync(client_id=payload.client_id, frame=payload))["acknowledged"], accepted)
        with patch("engine.backtest_mcp.time.monotonic", side_effect=lambda: clock[0]):
            result = self.run_mock(hold(), payload=payload, mutate=acknowledge_then_finish_late)
            recovered = self.recover(payload)
        self.assertEqual(result["decision"]["action"], "HOLD")
        self.assertEqual(recovered["analysis"], result)
        self.assertEqual(recovered["acknowledged"], accepted)
        self.assertFalse(self.analyzer._lock.locked())
        self.assertIsNone(self.analyzer._backtest_mcp)

    def test_final_session_rejection_reports_precise_safe_category(self):
        payload = self.recovery_frame()
        self.analyzer.terminal = Mock()
        def invalidate():
            self.analyzer._catalog_revision += 1
        with self.assertRaises(HTTPException) as rejected:
            self.run_mock(hold(), payload=payload, mutate=invalidate)
        self.assertEqual(rejected.exception.status_code, 409)
        self.assertIn("configuration", rejected.exception.detail)
        diagnostic = next(call for call in self.analyzer.terminal.write.call_args_list if call.args[0] == "backtest.rejected")
        self.assertEqual(diagnostic.kwargs["code"], "mcp_configuration_changed")

    def test_recovery_rejects_changed_configuration_and_strategy(self):
        payload = self.recovery_frame()
        self.run_mock(hold(), payload=payload)
        self.analyzer._catalog_revision += 1
        with self.assertRaises(HTTPException) as error:
            self.recover(payload)
        self.assertEqual(error.exception.status_code, 409)
        self.run_mock(hold(), payload=payload)
        with patch("engine.backtest_bridge.load_backtest_documents", return_value=([{"sha256": "changed"}], [])):
            with self.assertRaises(HTTPException) as error:
                self.sync(ToolSync(client_id=payload.client_id, frame=payload))
        self.assertEqual(error.exception.status_code, 409)

    def test_reset_and_expiration_remove_recoverable_results(self):
        payload = self.recovery_frame()
        self.run_mock(hold(), payload=payload)
        self.reset(ToolOwner(client_id=payload.client_id))
        self.assertEqual(self.recover(payload), {"command": None})
        self.run_mock(hold(), payload=payload)
        with patch("engine.backtest_bridge.time.monotonic", return_value=time.monotonic() + 1000):
            with self.assertRaises(HTTPException) as error:
                self.recover(payload)
        self.assertEqual(error.exception.status_code, 409)

    def test_reset_during_analysis_prevents_final_result_publication(self):
        payload = self.recovery_frame()
        with self.assertRaises(HTTPException) as error:
            self.run_mock(hold(), payload=payload, mutate=lambda: self.reset(ToolOwner(client_id=payload.client_id)))
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(self.analyzer._lock.locked())
        self.assertEqual(self.recover(payload), {"command": None})

    def test_cached_result_cannot_cross_replay_generations(self):
        payload = self.recovery_frame(replay_id=str(uuid.uuid4()))
        result = self.run_mock(hold(), payload=payload)
        with self.assertRaises(HTTPException) as error:
            self.recover(payload.model_copy(update={"replay_id": str(uuid.uuid4())}))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.recover(payload), {"command": None, "analysis": result})

    def test_reset_during_final_validation_prevents_direct_response_and_recovery(self):
        payload = self.recovery_frame()
        finalizer = threading.get_ident()
        validate = BacktestDecision.model_validate

        def reset_before_publication(output):
            result = validate(output)
            if threading.get_ident() == finalizer:
                reset = threading.Thread(target=lambda: self.reset(ToolOwner(client_id=payload.client_id)))
                reset.start()
                reset.join(timeout=2)
                self.assertFalse(reset.is_alive())
            return result

        with patch.object(BacktestDecision, "model_validate", side_effect=reset_before_publication):
            with self.assertRaises(HTTPException) as error:
                self.run_mock(hold(), payload=payload)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.recover(payload), {"command": None})
        self.assertFalse(self.analyzer._lock.locked())

    def test_cached_result_rejects_mismatched_frame_owner(self):
        payload = self.recovery_frame(replay_id=str(uuid.uuid4()))
        result = self.run_mock(hold(), payload=payload)
        for owner in (None, str(uuid.uuid4())):
            with self.subTest(owner=owner), patch("engine.backtest_bridge.load_backtest_documents", return_value=([{"sha256": "v1"}], [])):
                with self.assertRaises(HTTPException) as error:
                    self.sync(ToolSync(client_id=payload.client_id, frame=payload.model_copy(update={"client_id": owner})))
                self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.recover(payload), {"command": None, "analysis": result})

    def test_disconnected_response_keeps_validated_result_for_sync_recovery(self):
        payload = self.recovery_frame()
        started = threading.Event()
        release = threading.Event()

        def block():
            started.set()
            self.assertTrue(release.wait(2))

        async def disconnect(operation):
            task = asyncio.create_task(operation)
            self.assertTrue(await asyncio.to_thread(started.wait, 2))
            task.cancel()
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task

        self.run_mock(hold(), mutate=block, payload=payload, execute=disconnect)
        self.assertEqual(self.recover(payload)["analysis"]["decision"]["action"], "HOLD")

    def test_accepted_ack_remains_recoverable_when_final_analysis_fails(self):
        payload = self.recovery_frame()
        accepted = []

        def fail_after_ack():
            def apply():
                with patch.dict(os.environ, self.analyzer._backtest_mcp):
                    exchange("/call", {"name": "apply_chart", "arguments": {}})

            worker = threading.Thread(target=apply)
            worker.start()
            deadline = time.monotonic() + 2
            command = None
            while command is None and time.monotonic() < deadline:
                command = self.sync(ToolSync(client_id=payload.client_id, frame=payload))["command"]
                if command is None:
                    time.sleep(.005)
            self.assertIsNotNone(command)
            accepted.append(command["id"])
            self.ack(ToolAck(client_id=payload.client_id, frame=payload, command_id=command["id"], error=""))
            worker.join(2)
            self.assertFalse(worker.is_alive())
            raise CliRequestError("final_result")

        with self.assertRaises(HTTPException):
            self.run_mock(hold(), mutate=fail_after_ack, payload=payload)
        self.assertEqual(self.recover(payload), {"command": None, "acknowledged": accepted})
        self.reset(ToolOwner(client_id=payload.client_id))
        self.assertEqual(self.recover(payload), {"command": None})

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
            with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", side_effect=load_documents), patch("engine.backtest_bridge.importlib.util.spec_from_file_location") as load_adapter:
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

        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", side_effect=load_documents), patch("engine.backtest_bridge.importlib.util.spec_from_file_location") as load_adapter:
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
        with patch("engine.backtest_bridge.Path.is_file", return_value=True), patch("engine.backtest_bridge.load_backtest_documents", return_value=(documents, [])), patch("engine.backtest_bridge.importlib.util.spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))), patch("engine.backtest_bridge.importlib.util.module_from_spec", return_value=module):
            asyncio.run(cancel_request())
        self.assertFalse(self.analyzer._lock.locked())
        self.assertFalse(images[0].exists())
