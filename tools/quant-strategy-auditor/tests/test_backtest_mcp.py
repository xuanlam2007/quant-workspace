import json
import io
import os
import sys
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.backtest_bridge import BacktestFrame, ToolAck, ToolSync
from engine.backtest_mcp import QuantTools, QuantSessionError, serve_tools
from engine.backtest_timing import ANALYSIS_TIMEOUT, REQUEST_LIFETIME, COMMAND_ACK_TIMEOUT
from engine.quant_mcp_stdio import dispatch, exchange
from engine.cli_analyzer import CliLearningAnalyzer, codex_output_schema
from engine.ai_request_terminal import cli_failure
from engine.observer_guard import decide
from engine.cli_diagnostics import agy_step_error
from engine import backtest_agent
from unittest.mock import Mock
from pydantic import ValidationError
from test_backtest_bridge import frame, hold


class QuantMcpTests(unittest.TestCase):
    def setUp(self):
        self.owner = str(uuid.uuid4())
        self.frame = frame(client_id=self.owner)
        self.current = True
        self.tools = QuantTools(self.frame, lambda: self.current)
        self.addCleanup(self.tools.close)

    def test_tools_use_strict_schemas_and_lazy_catalog(self):
        definitions = self.tools.definitions()
        self.assertEqual(len(definitions), 6)
        for tool in definitions:
            self.assertFalse(tool["inputSchema"]["additionalProperties"])
            self.assertFalse(tool["annotations"]["openWorldHint"])
            self.assertEqual(tool["annotations"]["readOnlyHint"], tool["name"] not in ("apply_chart", "submit_order"))
        catalog = self.tools.call("get_chart_catalog", {})
        self.assertEqual(len(catalog["drawings"]), 16)
        self.assertGreater(len(catalog["indicators"]), 100)
        from engine.backtest_bridge import ReplayDrawing
        example = ReplayDrawing.model_validate(catalog["drawing_example"])
        self.assertLess(example.points[0].timestamp, self.frame.cutoff)
        self.assertIn("inputs", self.tools.call("get_chart_catalog", {"indicator_name": "Relative Strength Index"}))
        for name, args in (("get_chart_state", {"url": "forbidden"}), ("get_chart_state", {"limit": 2001}), ("capture_chart", {"path": "private"}), ("get_account_state", {"account": "real"})):
            with self.assertRaises(ValidationError):
                self.tools.call(name, args)

    def test_drawing_tool_schema_publishes_nested_fields_inline(self):
        schema = next(item["inputSchema"] for item in self.tools.definitions() if item["name"] == "apply_chart")
        self.assertNotIn('"$ref"', json.dumps(schema))
        self.assertNotIn("$defs", schema)
        drawing = schema["properties"]["drawings"]["items"]
        self.assertEqual(set(drawing["required"]), {"id", "tool", "points", "label"})
        self.assertFalse(drawing["additionalProperties"])
        self.assertIn("HorizontalLine", drawing["properties"]["tool"]["enum"])
        point = drawing["properties"]["points"]["items"]
        self.assertEqual(set(point["required"]), {"timestamp", "price"})
        self.assertFalse(point["additionalProperties"])

    def test_discovery_examples_match_execution_schemas_and_cutoff(self):
        state = self.tools.call("get_chart_state", {})
        self.assertNotIn("indicator_names", state)
        apply_schema = next(item["inputSchema"] for item in self.tools.definitions() if item["name"] == "apply_chart")
        self.assertEqual(apply_schema["properties"]["indicators"]["items"]["properties"]["name"]["enum"], [item["name"] for item in self.tools.catalog["indicators"]])
        self.assertEqual(state["price_note_example"]["tool"], "PriceNote")
        examples = self.tools.call("get_chart_catalog", {})["drawing_examples"]
        self.assertEqual({item["tool"] for item in examples}, set(self.tools.catalog["drawings"]))
        for drawing in examples:
            self.tools.models["apply_chart"].model_validate({"drawings": [drawing]})
            self.assertTrue(all(point["timestamp"] < self.frame.cutoff for point in drawing["points"]))
        self.tools.sync(frame(client_id=self.owner, drawings=[state["price_note_example"]]))
        self.assertNotIn("price_note_example", self.tools.call("get_chart_state", {}))

    def test_account_examples_reflect_flat_position_and_pending_order(self):
        pending = {"id": "pending", "side": "BUY", "purpose": "OPEN", "type": "MARKET", "stop": None, "limit": None, "submitted": 0, "triggered": None, "status": "waiting", "filled": None, "price": None}
        for position, orders, expected in (
            (None, [], ["OPEN_LONG", "OPEN_SHORT"]),
            ({"side": "LONG", "price": 100, "time": 0}, [], ["CLOSE"]),
            (None, [pending], ["CANCEL"]),
        ):
            self.tools.sync(frame(client_id=self.owner, position=position, orders=orders))
            result = self.tools.call("get_account_state", {})
            self.assertFalse(result["examples_are_signals"])
            self.assertEqual([item["action"] for item in result["submit_order_examples"]], expected)
            for example in result["submit_order_examples"]:
                self.tools.models["submit_order"].model_validate(example)
                self.tools.decision_model.model_validate({**example, "question": "", "drawings": []})
            self.assertIsNone(self.tools.pending)
            self.assertFalse(self.tools.order_attempted)

    def test_first_chart_read_supplies_executable_setup_without_catalog_roundtrip(self):
        data = self.tools.call("get_chart_state", {})
        example = data["apply_chart_example"]
        self.tools.models["apply_chart"].model_validate(example)
        self.assertEqual(example["drawings"][0]["tool"], "PriceNote")
        self.assertEqual(len(example["drawings"][0]["points"]), 2)
        self.assertLess(example["drawings"][0]["points"][0]["timestamp"], data["cutoff"])
        self.assertEqual(set(example["indicators"][0]), {"id", "name", "inputs", "visible", "operation"})
        self.assertIsInstance(self.run_command("apply_chart", example), dict)
        self.assertEqual(self.tools.complete(hold())["action"], "HOLD")
        self.assertNotIn("apply_chart_example", self.tools.call("get_chart_state", {}))

    def test_sync_exposes_fixed_tool_activity_without_arguments(self):
        self.assertIsNone(self.tools.sync(self.frame)["activity"])
        self.tools.call("get_chart_state", {})
        self.assertEqual(self.tools.sync(self.frame)["activity"], {"sequence": 1, "tool": "get_chart_state", "state": "DONE"})
        self.run_command("apply_chart", {}, "Chart not ready")
        self.assertEqual(self.tools.sync(self.frame)["activity"], {"sequence": 2, "tool": "apply_chart", "state": "ERROR"})

    def test_compact_chart_preserves_candle_values_and_cutoff(self):
        normal = self.tools.call("get_chart_state", {"limit": 30})
        compact = self.tools.call("get_chart_state", {"limit": 30, "compact": True})
        columns = compact.pop("bar_columns")
        restored = [dict(zip(columns, row)) for row in compact["bars"]]
        self.assertEqual(restored, normal["bars"])
        self.assertTrue(all(row["time"] < compact["cutoff"] for row in restored))
        self.assertEqual({key: value for key, value in compact.items() if key != "bars"}, {key: value for key, value in normal.items() if key != "bars"})

    def test_quant_operation_rejection_is_not_permission_denial(self):
        diagnostic = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": "Quant tool rejected. Request expired or chart operation unavailable."}})
        self.assertEqual(diagnostic.code, "mcp_operation")
        self.assertNotIn("permission hook", diagnostic.safe_message)
        self.assertNotIn("No order was applied", diagnostic.safe_message)
        denied = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": "permission denied"}})
        self.assertEqual(denied.code, "mcp_permission")

    def test_invalid_and_unknown_tool_calls_consume_request_budget(self):
        for index in range(20):
            with self.assertRaises((ValueError, ValidationError)):
                self.tools.call("unknown" if index % 2 else "get_chart_state", {"unknown_field": True})
        self.assertEqual(self.tools.calls, 20)
        with self.assertRaisesRegex(ValueError, "budget exceeded"):
            self.tools.call("get_chart_state", {})
        self.assertFalse(self.tools.chart_read)
        self.assertIsNone(self.tools.pending)

    def test_equivalent_indicator_with_new_id_skips_chart_command(self):
        indicator = {"id": "ai-trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}
        raw = self.frame.model_dump()
        raw["indicators"] = [{**indicator, "status": "ready", "values": []}]
        self.tools.frame = BacktestFrame.model_validate(raw)
        definition = next(item for item in self.tools.catalog["indicators"] if item["name"] == "Moving Average")
        explicit = [{"id": item["id"], "value": item["default"]} for item in definition["inputs"] if "default" in item]
        result = self.tools.call("apply_chart", {"indicators": [{**indicator, "id": "another-ma", "inputs": explicit}]})
        self.assertTrue(result["unchanged"])
        self.assertEqual(len(result["indicators"]), 1)
        self.assertIsNone(self.tools.pending)
        self.assertEqual(self.tools.calls, 1)

    def test_indicator_reuse_preserves_distinct_settings_and_retries(self):
        indicator = {"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}
        self.assertEqual(len(self.tools.reuse_indicators([indicator, {**indicator, "id": "duplicate"}])), 1)
        raw = self.frame.model_dump()
        raw["indicators"] = [{**indicator, "status": "error", "values": []}]
        self.tools.frame = BacktestFrame.model_validate(raw)
        self.assertEqual(self.tools.reuse_indicators([indicator]), [indicator])
        raw["indicators"][0]["status"] = "ready"
        self.tools.frame = BacktestFrame.model_validate(raw)
        different = {**indicator, "id": "longer", "inputs": [{"id": "length", "value": 30}]}
        self.assertEqual(self.tools.reuse_indicators([different]), [different])
        remove = {**indicator, "operation": "remove"}
        self.assertEqual(self.tools.reuse_indicators([remove, indicator]), [remove, indicator])

    def test_malformed_http_call_envelopes_consume_request_budget(self):
        with serve_tools(self.tools) as environment, patch.dict(os.environ, environment):
            for _ in range(20):
                with self.assertRaises(HTTPError) as rejected:
                    exchange("/call", {"name": "get_chart_state", "arguments": {}, "unknown": True})
                rejected.exception.close()
            self.assertEqual(self.tools.calls, 20)
            with self.assertRaises(HTTPError) as rejected:
                exchange("/call", {"name": "get_chart_state", "arguments": {}})
            rejected.exception.close()
        self.assertFalse(self.tools.chart_read)

    def test_read_revealed_only_and_reject_future_indicator_values(self):
        self.assertEqual(self.tools.call("get_chart_state", {})["bars"][0]["time"], 0)
        self.assertEqual(self.tools.call("get_chart_state", {"after_time": 0})["bars"], [])
        raw = self.frame.model_dump()
        raw["indicators"] = [{"id": "rsi", "name": "Relative Strength Index", "inputs": [], "visible": True, "operation": "upsert", "values": [{"time": 60, "values": {"rsi": 50.0}}]}]
        with self.assertRaises(ValidationError):
            BacktestFrame.model_validate(raw)
        raw["indicators"][0]["values"][0]["time"] = 0
        self.assertEqual(BacktestFrame.model_validate(raw).indicators[0].values[0].values["rsi"], 50)
        raw["indicators"][0]["values"][0]["values"]["rsi"] = float("nan")
        with self.assertRaises(ValidationError):
            BacktestFrame.model_validate(raw)

    def test_owner_cutoff_revision_and_reset_guards(self):
        with self.assertRaises(ValueError):
            self.tools.sync(frame(client_id=str(uuid.uuid4())))
        with self.assertRaises(ValidationError):
            ToolSync(client_id=self.owner, frame=self.frame, secret="forbidden")
        with self.assertRaises(ValidationError):
            ToolAck(client_id=self.owner, frame=self.frame, command_id=str(uuid.uuid4()), error="", effective_time=0)
        self.current = False
        with self.assertRaises(ValueError):
            self.tools.call("get_account_state", {})

    def test_waiting_sync_wakes_for_command_and_ack_completes_once(self):
        waiting = threading.Event()
        synced, completed = [], []
        original = self.tools.condition.wait_for
        def wait_for(predicate, timeout):
            waiting.set()
            return original(predicate, timeout)
        with patch.object(self.tools.condition, "wait_for", side_effect=wait_for):
            reader = threading.Thread(target=lambda: synced.append(self.tools.sync(self.frame, wait=.4)))
            reader.start()
            self.assertTrue(waiting.wait(1))
            writer = threading.Thread(target=lambda: completed.append(self.tools.call("apply_chart", {})))
            writer.start()
            reader.join(1)
            self.assertFalse(reader.is_alive())
            self.assertIsNotNone(synced[0]["command"])
            command = synced[0]["command"]
            self.tools.ack(command["id"], self.frame, "")
            writer.join(1)
            self.assertFalse(writer.is_alive())
            self.assertEqual(len(completed), 1)
            self.assertEqual(list(self.tools.acknowledgements), [command["id"]])

    def test_waiting_sync_revalidates_after_reset(self):
        waiting = threading.Event()
        rejected = []
        original = self.tools.condition.wait_for
        def wait_for(predicate, timeout):
            waiting.set()
            return original(predicate, timeout)
        def sync():
            try:
                self.tools.sync(self.frame, wait=.4)
            except ValueError:
                rejected.append(True)
        with patch.object(self.tools.condition, "wait_for", side_effect=wait_for):
            reader = threading.Thread(target=sync)
            reader.start()
            self.assertTrue(waiting.wait(1))
            self.tools.close()
            reader.join(1)
            self.assertFalse(reader.is_alive())
            self.assertEqual(rejected, [True])

    def run_command(self, name, arguments, error=""):
        results = []
        def invoke():
            try:
                results.append(self.tools.call(name, arguments))
            except Exception as exc:
                results.append(exc)
        worker = threading.Thread(target=invoke)
        worker.start()
        deadline = time.monotonic() + 2
        while not self.tools.pending and time.monotonic() < deadline:
            time.sleep(.005)
        command = self.tools.sync(self.frame)["command"]
        self.assertIsNotNone(command)
        if name == "apply_chart" and not error:
            state = self.frame.model_dump()
            drawings = {item["id"]: item for item in state["drawings"]}
            drawings.update({item["id"]: item for item in arguments.get("drawings", [])})
            indicators = {item["id"]: item for item in state["indicators"]}
            for item in arguments.get("indicators", []):
                if item["operation"] == "remove":
                    indicators.pop(item["id"], None)
                else:
                    indicators[item["id"]] = {**item, "status": "ready", "values": []}
            self.frame = BacktestFrame.model_validate({**state, "drawings": list(drawings.values()), "indicators": list(indicators.values())})
        self.tools.ack(command["id"], self.frame, error)
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(self.tools.ack(command["id"], self.frame, error), {"ok": True})
        with self.assertRaisesRegex(ValueError, "payload changed"):
            self.tools.ack(command["id"], self.frame, error + "changed")
        return results[0]

    def test_delayed_ack_does_not_roll_replay_back_after_sync_advances(self):
        results = []
        worker = threading.Thread(target=lambda: results.append(self.tools.call("apply_chart", {})))
        worker.start()
        deadline = time.monotonic() + 2
        while not self.tools.pending and time.monotonic() < deadline:
            time.sleep(.005)
        command = self.tools.sync(self.frame)["command"]
        self.assertIsNotNone(command)
        later = self.frame.model_copy(update={"cutoff": self.frame.cutoff + 60})
        self.tools.sync(later)
        self.assertEqual(self.tools.ack(command["id"], self.frame, ""), {"ok": True})
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(results[0]["cutoff"], self.frame.cutoff)
        self.assertEqual(self.tools.frame.cutoff, later.cutoff)
        self.assertIn(command["id"], self.tools.sync(later)["acknowledged"])
        self.assertEqual(self.tools.ack(command["id"], self.frame, ""), {"ok": True})
        self.assertEqual(self.tools.frame.cutoff, later.cutoff)

    def test_operation_failures_report_fixed_codes_without_raw_chart_errors(self):
        failed = self.run_command("apply_chart", {}, "chart_apply_failed")
        self.assertEqual(failed.code, "chart_apply_failed")
        private = self.run_command("apply_chart", {}, "private chart diagnostic")
        self.assertEqual(str(private), "chart_rejected")
        diagnostic = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": "Quant operation_failed: ack_timeout. Earlier acknowledged actions remain applied."}})
        self.assertEqual(diagnostic.code, "mcp_ack_timeout")
        self.assertIn("25 seconds", diagnostic.safe_message)

    def test_stdio_preserves_only_allowlisted_operation_failure_code(self):
        def rejected(*_):
            raise HTTPError("http://127.0.0.1/call", 422, "private diagnostic", {}, io.BytesIO(b'{"error":"operation_failed","code":"ack_timeout","private":"secret"}'))
        response, _ = dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "apply_chart", "arguments": {}}}, True, rejected)
        self.assertTrue(response["result"]["isError"])
        message = response["result"]["content"][0]["text"]
        self.assertIn("operation_failed: ack_timeout", message)
        self.assertNotIn("secret", message)
        self.assertNotIn("private", message)

    def test_order_rejection_keeps_specific_category_without_raw_diagnostics(self):
        def rejected(*_):
            raise HTTPError("http://127.0.0.1/call", 422, "private diagnostic", {}, io.BytesIO(b'{"error":"operation_failed","code":"order_rejected","private":"secret"}'))
        response, _ = dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "submit_order", "arguments": {}}}, True, rejected)
        self.assertTrue(response["result"]["isError"])
        message = response["result"]["content"][0]["text"]
        diagnostic = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": message}})
        self.assertEqual(diagnostic.code, "mcp_order_rejected")
        self.assertIn("simulated account", diagnostic.safe_message)
        self.assertNotIn("secret", diagnostic.safe_message)
        self.assertNotIn("private", diagnostic.safe_message)

    def test_native_drawings_ack_and_duplicate_order_protection(self):
        drawing = {"id": "line", "tool": "HorizontalLine", "points": [{"timestamp": 0, "price": 100}], "label": "Support"}
        indicator = {"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}
        result = self.run_command("apply_chart", {"drawings": [drawing], "indicators": [indicator]})
        self.assertEqual(result["cutoff"], 60)
        drawing["points"][0]["timestamp"] = 60
        with self.assertRaises(ValueError):
            self.tools.call("apply_chart", {"drawings": [drawing], "indicators": []})
        order = {"action": "OPEN_LONG", "order_type": "STOP_LIMIT", "stop_price": 101, "limit_price": 102, "reason": "Fixture"}
        self.assertIsInstance(self.run_command("submit_order", order), dict)
        self.assertTrue(self.tools.order_applied)
        with self.assertRaises(ValueError):
            self.tools.call("submit_order", order)

    def test_capture_uses_canvas_png_and_tool_error_does_not_claim_success(self):
        result = self.run_command("capture_chart", {})
        self.assertEqual(result["image"], self.frame.image.split(",")[1])
        result = self.run_command("apply_chart", {}, "Chart not ready")
        self.assertIsInstance(result, ValueError)

    def test_loopback_capability_and_mcp_protocol(self):
        with serve_tools(self.tools) as environment, patch.dict(os.environ, environment):
            response, initialized = dispatch({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "fixture", "version": "1"}}}, False)
            self.assertTrue(initialized)
            self.assertEqual(response["result"]["capabilities"], {"tools": {}})
            response, _ = dispatch({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, True)
            self.assertEqual(len(response["result"]["tools"]), 6)
            response, _ = dispatch({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_account_state", "arguments": {}}}, True)
            self.assertFalse(response["result"]["isError"])
            self.assertIsNone(json.loads(response["result"]["content"][0]["text"])["position"])
            response, _ = dispatch({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "shell", "arguments": {}}}, True)
            self.assertTrue(response["result"]["isError"])
            with patch.dict(os.environ, {"QUANT_MCP_CAPABILITY": "wrong"}):
                for _ in range(8):
                    with self.assertRaises(HTTPError) as rejected:
                        exchange("/tools", {})
                    self.assertEqual(rejected.exception.code, 403)
                    rejected.exception.close()
            self.assertEqual(len(exchange("/tools", {})["tools"]), 6)
        self.assertTrue(self.tools.closed)

    def test_no_tools_before_initialize_or_unknown_top_level_fields(self):
        for message in ({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "shell": True}):
            result, _ = dispatch(message, False)
            self.assertIn("error", result)

    def test_invalid_tool_arguments_return_safe_repair_fields(self):
        with serve_tools(self.tools) as environment, patch.dict(os.environ, environment):
            response, _ = dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "apply_chart", "arguments": {"drawings": [{"tool": "HorizontalLine", "points": [{"timestamp": 0, "price": 100}], "label": "private label", "private_credential_field": "secret"}]}}}, True)
        self.assertTrue(response["result"]["isError"])
        message = response["result"]["content"][0]["text"]
        self.assertIn("invalid_arguments", message)
        self.assertIn("drawings.0.id", message)
        self.assertIn("redacted", message)
        self.assertIn("Allowed top-level keys: drawings, indicators", message)
        for private in ("private label", "private_credential_field", "secret"):
            self.assertNotIn(private, message)
        self.assertIsNone(self.tools.pending)

    def test_indicator_argument_repair_reports_types_without_private_values(self):
        arguments = {"indicators": [{"id": "trend", "name": "Moving Average", "inputs": {}, "visible": "private-value", "operation": "upsert"}]}
        with serve_tools(self.tools) as environment, patch.dict(os.environ, environment):
            response, _ = dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "apply_chart", "arguments": arguments}}, True)
        message = response["result"]["content"][0]["text"]
        self.assertTrue(response["result"]["isError"])
        self.assertIn("indicators.0.inputs: expected array", message)
        self.assertIn("indicators.0.visible: expected boolean", message)
        self.assertNotIn("private-value", message)
        diagnostic = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": message}})
        self.assertEqual(diagnostic.code, "mcp_arguments")
        self.assertIn("Fields: indicators.0.inputs, indicators.0.visible.", diagnostic.safe_message)
        unsafe = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": "Quant invalid_arguments: private_secret. Correct the tool arguments using its schema, then retry the tool."}})
        self.assertNotIn("private_secret", unsafe.safe_message)
        self.assertIsNone(self.tools.pending)

    def test_reset_wakes_pending_command_without_success(self):
        failures = []
        def invoke():
            try:
                self.tools.call("apply_chart", {})
            except ValueError as error:
                failures.append(error)
        worker = threading.Thread(target=invoke)
        worker.start()
        deadline = time.monotonic() + 2
        while not self.tools.pending and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertIsNotNone(self.tools.pending)
        self.tools.close()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(failures), 1)

    def test_codex_capability_is_environment_only_and_not_global(self):
        capability = {"QUANT_MCP_PORT": "12345", "QUANT_MCP_CAPABILITY": "fixture-private-capability"}
        captured = []
        def run(command, **kwargs):
            captured.append((command, kwargs))
            Path(command[command.index("-o") + 1]).write_text('{"action":"HOLD"}', encoding="utf-8")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        analyzer = CliLearningAnalyzer({"provider": "CODEX"})
        with patch("engine.cli_analyzer.find_cli", return_value="codex.exe"), patch("engine.cli_analyzer.run_cli", side_effect=run):
            analyzer._run_request("Fixture", analyzer.settings, quant_mcp=capability)
            analyzer._run_request("Fixture", analyzer.settings)
        command, options = captured[0]
        self.assertNotIn(capability["QUANT_MCP_CAPABILITY"], " ".join(command))
        self.assertIn("mcp_servers.quant.required=true", command)
        self.assertIn('mcp_servers.quant.default_tools_approval_mode="approve"', command)
        enabled = next(item.split("=", 1)[1] for item in command if item.startswith("mcp_servers.quant.enabled_tools="))
        self.assertEqual(set(json.loads(enabled)), set(self.tools.models))
        self.assertIn("mcp_servers.quant.env_vars=", " ".join(command))
        self.assertEqual(options["env"]["QUANT_MCP_CAPABILITY"], capability["QUANT_MCP_CAPABILITY"])
        self.assertNotIn("QUANT_MCP_CAPABILITY", captured[1][1]["env"])
        self.assertNotIn("mcp_servers.quant", " ".join(captured[1][0]))

    def test_codex_output_requires_defaulted_fields_without_changing_route_schema(self):
        from engine.backtest_bridge import BacktestDecision
        schema = BacktestDecision.model_json_schema()
        self.assertNotIn("indicators", schema["required"])
        normalized = codex_output_schema(schema)
        self.assertIn("indicators", normalized["required"])
        for node in [normalized, *normalized["$defs"].values()]:
            if "properties" in node:
                self.assertEqual(set(node["required"]), set(node["properties"]))
                self.assertFalse(node["additionalProperties"])
        self.assertNotIn("indicators", schema["required"])
        self.assertEqual(normalized["properties"]["stop_price"]["anyOf"][-1], {"type": "null"})

    def test_completion_requires_actual_read_and_acknowledged_mutations(self):
        with self.assertRaisesRegex(ValueError, "must read"):
            self.tools.complete(hold())

        self.tools.call("get_chart_catalog", {})
        with self.assertRaisesRegex(ValueError, "must read"):
            self.tools.complete(hold())
        self.tools.call("get_chart_state", {})
        with self.assertRaisesRegex(ValueError, "drawing"):
            self.tools.complete(hold())
        drawing = {"id": "level", "tool": "HorizontalLine", "points": [{"timestamp": 0, "price": 100}], "label": "Reference level"}
        self.run_command("apply_chart", {"drawings": [drawing]})
        with self.assertRaisesRegex(ValueError, "indicator"):
            self.tools.complete(hold())
        indicator = {"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}
        self.run_command("apply_chart", {"indicators": [indicator]})
        self.assertEqual(self.tools.complete(hold())["action"], "HOLD")
        self.assertEqual(self.tools.frame.indicators[0].values, [])
        calls = self.tools.calls
        self.assertEqual(self.tools.complete(hold())["action"], "HOLD")
        self.assertEqual(self.tools.calls, calls)
        with self.assertRaisesRegex(ValueError, "acknowledged Quant"):
            self.tools.complete({**hold(), "action": "OPEN_LONG"})
        self.tools.close()
        with self.assertRaises(ValueError):
            self.tools.complete(hold())

    def test_acknowledged_result_survives_previous_110_second_expiry(self):
        self.tools.call("get_chart_state", {})
        state = self.tools.call("get_chart_state", {})["apply_chart_example"]
        self.run_command("apply_chart", state)
        acknowledgement_ids = list(self.tools.acknowledgements)
        self.assertEqual(ANALYSIS_TIMEOUT, 120)
        self.assertEqual(COMMAND_ACK_TIMEOUT, 25)
        for elapsed in (110, 117.203, 119.999, 125, REQUEST_LIFETIME - .001):
            with self.subTest(elapsed=elapsed), patch("engine.backtest_mcp.time.monotonic", return_value=self.tools.started + elapsed):
                synced = self.tools.sync(self.frame)
                self.assertFalse(self.tools.closed)
                self.assertEqual(synced["acknowledged"], acknowledgement_ids)
                self.assertEqual(self.tools.complete(hold())["action"], "HOLD")
        with patch("engine.backtest_mcp.time.monotonic", return_value=self.tools.started + REQUEST_LIFETIME):
            with self.assertRaises(QuantSessionError) as expired:
                self.tools.complete(hold())
            self.assertEqual(expired.exception.code, "request_expired")

    def test_completion_rejects_reset_config_change_and_pending_command_specifically(self):
        self.tools.call("get_chart_state", {})
        self.current = False
        with self.assertRaises(QuantSessionError) as changed:
            self.tools.complete(hold())
        self.assertEqual(changed.exception.code, "configuration_changed")
        self.current = True
        self.tools.pending = {"id": "pending"}
        with self.assertRaises(QuantSessionError) as pending:
            self.tools.complete(hold())
        self.assertEqual(pending.exception.code, "command_pending")
        self.tools.close()
        with self.assertRaises(QuantSessionError) as closed:
            self.tools.complete(hold())
        self.assertEqual(closed.exception.code, "session_closed")

    def test_failed_chart_setup_blocks_orders_without_claiming_visual_success(self):
        self.tools.call("get_chart_state", {})
        self.run_command("apply_chart", {}, "Chart not ready")
        order = {"action": "OPEN_LONG", "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "Fixture"}
        with self.assertRaisesRegex(ValueError, "drawing"):
            self.tools.call("submit_order", order)
        self.assertFalse(self.tools.order_attempted)
        self.assertFalse(self.tools.order_applied)
        self.assertIsNone(self.tools.pending)

    def test_existing_visual_setup_is_reused_but_error_indicator_is_rejected(self):
        drawing = {"id": "level", "tool": "HorizontalRay", "points": [{"timestamp": 0, "price": 100}], "label": "Reference"}
        indicator = {"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert", "status": "ready"}
        self.tools.sync(frame(client_id=self.owner, drawings=[drawing], indicators=[indicator]))
        self.tools.call("get_chart_state", {})
        self.assertEqual(self.tools.complete(hold())["action"], "HOLD")
        self.assertEqual(self.tools.calls, 1)
        for changes in ({"status": "error"}, {"status": "loading"}, {"visible": False}, {"name": "Volume"}):
            self.tools.sync(frame(client_id=self.owner, drawings=[drawing], indicators=[{**indicator, **changes}]))
            with self.assertRaisesRegex(ValueError, "indicator"):
                self.tools.complete(hold())

    def test_agy_mcp_prompt_uses_native_dispatcher_and_no_evidence_file(self):
        analyzer = SimpleNamespace(settings={"provider": "AGY"}, _backtest_mcp={"QUANT_MCP_PORT": "12345", "QUANT_MCP_CAPABILITY": "fixture"}, _run=Mock(return_value=json.dumps(hold())))
        backtest_agent.analyze(analyzer, self.frame.model_dump(), [], Path("unused.png"), self.tools.decision_model.model_json_schema())
        prompt = analyzer._run.call_args.args[0]
        self.assertIn('ServerName="quant-backtest_quant"', prompt)
        self.assertIn("use view_file on that exact JSON or PNG artifact", prompt)
        self.assertIn("Never guess paths", prompt)
        self.assertIn("Vietnamese with full diacritics", prompt)
        self.assertIn("Never address the user by name", prompt)
        self.assertIn("PriceLabel", prompt)
        self.assertIn("PriceNote", prompt)
        self.assertIn("submit_order once", prompt)
        self.assertIsNone(analyzer._run.call_args.kwargs["image"])
        self.assertEqual(analyzer._run.call_args.kwargs["timeout"], ANALYSIS_TIMEOUT)

    def test_mcp_summary_schema_cannot_encode_unacknowledged_actions(self):
        original = self.tools.decision_model.model_json_schema()
        summary = backtest_agent.mcp_summary_schema(original)
        self.assertEqual(summary["properties"]["action"]["enum"], ["HOLD"])
        for field in ("drawings", "indicators"):
            self.assertEqual(summary["properties"][field]["maxItems"], 0)
        self.assertEqual(summary["properties"]["reason"]["maxLength"], 240)
        self.assertNotIn("$defs", summary)
        self.assertGreater(original["properties"]["drawings"]["maxItems"], 0)
        self.assertLess(len(json.dumps(summary)), len(json.dumps(original)) // 2)

    def test_all_registered_drawing_types_are_available_and_acknowledged(self):
        state = self.tools.call("get_chart_state", {})
        self.assertEqual(state["drawing_tools"], self.tools.catalog["drawings"])
        drawings = [{"id": "annotation_" + name, "tool": name, "points": [{"timestamp": index, "price": 100 + index} for index in range(count)], "label": "Mức giá"} for name, count in state["drawing_tools"].items()]
        indicator = {"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}
        self.assertIsInstance(self.run_command("apply_chart", {"drawings": drawings, "indicators": [indicator]}), dict)
        self.assertEqual({item.tool for item in self.tools.frame.drawings}, set(state["drawing_tools"]))
        for drawing in drawings:
            with self.subTest(tool=drawing["tool"]):
                self.tools.sync(frame(client_id=self.owner, drawings=[drawing], indicators=[indicator]))
                self.assertEqual(self.tools.complete(hold())["action"], "HOLD")
                self.assertNotIn("apply_chart_example", self.tools.call("get_chart_state", {}))

    def test_price_note_setup_allows_simulated_order_without_horizontal_line(self):
        self.tools.call("get_chart_state", {})
        note = {"id": "entry_note", "tool": "PriceNote", "points": [{"timestamp": 0, "price": 100}, {"timestamp": 0, "price": 101}], "label": "Điểm vào mô phỏng"}
        indicator = {"id": "trend", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}
        self.run_command("apply_chart", {"drawings": [note], "indicators": [indicator]})
        order = {"action": "OPEN_LONG", "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "Tín hiệu mô phỏng"}
        self.tools.call("get_account_state", {})
        self.assertIsInstance(self.run_command("submit_order", order), dict)
        self.assertTrue(self.tools.order_applied)
        self.assertEqual(self.tools.complete(hold())["action"], "HOLD")

    def test_mcp_prompt_omits_duplicate_market_data_and_bounds_prior_summaries(self):
        context = {**self.frame.model_dump(), "bars": [self.frame.model_dump()["bars"][0]] * 1000,
                   "history": [{"cutoff": index, "action": "HOLD", "reason": "x" * 6000} for index in range(20)]}
        documents = [{"name": "Fixture.md", "content": "Use revealed evidence only"}]
        for provider in ("CODEX", "AGY"):
            analyzer = SimpleNamespace(settings={"provider": provider, "effort": "medium"}, _backtest_mcp={"QUANT_MCP_CAPABILITY": "private-fixture-capability"}, _run=Mock(return_value=json.dumps(hold())))
            backtest_agent.analyze(analyzer, context, documents, Path("unused.png"), self.tools.decision_model.model_json_schema())
            prompt = analyzer._run.call_args.args[0]
            metadata = json.loads(prompt.split("Replay metadata (data):\n")[1].split("\nTrusted AGY")[0])
            self.assertEqual(set(metadata), {"symbol", "cutoff", "granularity", "teaching", "history"})
            self.assertEqual([item["cutoff"] for item in metadata["history"]], [17, 18, 19])
            self.assertTrue(all(len(item["reason"]) == 240 for item in metadata["history"]))
            self.assertNotIn("private-fixture-capability", prompt)
            self.assertNotIn(self.frame.image, prompt)
            self.assertIn(documents[0]["content"], prompt)
            self.assertEqual(analyzer._run.call_args.args[1]["effort"], "medium")
            self.assertIsNone(analyzer._run.call_args.kwargs["image"])

    def test_agy_quant_config_is_temporary_and_guard_is_scoped(self):
        capability = {"QUANT_MCP_PORT": "12345", "QUANT_MCP_CAPABILITY": "fixture-capability"}
        folders = []
        def run(command, **options):
            folder = Path(options["cwd"])
            folders.append(folder)
            plugin = folder / ".agents" / "plugins" / "quant-backtest"
            self.assertEqual(json.loads((plugin / "plugin.json").read_text())["name"], "quant-backtest")
            config = json.loads((plugin / "mcp_config.json").read_text())
            server = config["mcpServers"]["quant"]
            self.assertTrue(server["trust"])
            self.assertEqual(set(server["enabledTools"]), set(self.tools.models))
            self.assertNotIn(capability["QUANT_MCP_CAPABILITY"], json.dumps(config))
            self.assertNotIn(capability["QUANT_MCP_CAPABILITY"], " ".join(command))
            self.assertEqual(options["env"]["QUANT_MCP_CAPABILITY"], capability["QUANT_MCP_CAPABILITY"])
            names = json.loads(options["env"]["QUANT_OBSERVER_MCP_TOOLS"])
            manifest = Path(options["env"]["QUANT_MCP_ARTIFACT_MANIFEST"])
            self.assertEqual(manifest.parent, folder / ".agents")
            self.assertEqual(json.loads(manifest.read_text()), {"entries": []})
            self.assertTrue((manifest.parent / "quant_mcp_artifacts.py").is_file())
            self.assertEqual(Path(options["env"]["QUANT_MCP_ARTIFACT_ROOT"]), Path.home() / ".gemini" / "antigravity-cli" / "brain")
            self.assertEqual(set(names), set(self.tools.models))
            self.assertTrue(options["mcp_only"])
            self.assertEqual(json.loads(command[command.index("--json-schema") + 1])["type"], "object")
            self.assertFalse((folder / "schema.json").exists())
            self.assertNotIn("--agent", command)
            self.assertEqual(command[command.index("--mode") + 1], "default")
            self.assertFalse((folder / ".agents" / "agents").exists())
            for name in ("view_file", "run_command"):
                rejected = decide({"toolCall": {"name": name, "args": {}}}, [], "backtest", names)
                self.assertEqual(rejected["decision"], "deny")
                self.assertIn("QUANT_MCP_ONLY:", rejected["reason"])
            for name in ("run_command", "mcp_other_submit_order", "mcp_quant_shell", "mcp_quant_get_chart_state_extra"):
                self.assertEqual(decide({"toolCall": {"name": name, "args": {}}}, [], "backtest", names)["decision"], "deny")
            dispatched = {"toolCall": {"name": "call_mcp_tool", "args": {"ServerName": "quant-backtest_quant", "ToolName": "get_chart_state", "Arguments": {"limit": 60}}}}
            self.assertEqual(decide(dispatched, [], "backtest", names)["decision"], "allow")
            self.assertEqual(decide(dispatched, [], "backtest", names)["permissionOverrides"], ["mcp(quant-backtest_quant/get_chart_state)"])
            self.assertEqual(decide(dispatched, [], "observation", names)["decision"], "deny")
            for changes in ({"ServerName": "other"}, {"ServerName": "quant"}, {"ToolName": "shell"}, {"CommandLine": "forbidden"}):
                self.assertEqual(decide({"toolCall": {"name": "call_mcp_tool", "args": {**dispatched["toolCall"]["args"], **changes}}}, [], "backtest", names)["decision"], "deny")
            self.assertNotIn("--dangerously-skip-permissions", command)
            return SimpleNamespace(returncode=0, stdout=json.dumps({"event": "result", "result": {"status": "SUCCESS", "structured_output": hold()}}))
        analyzer = CliLearningAnalyzer({"provider": "AGY"})
        with patch("engine.cli_analyzer.find_cli", return_value="agy.exe"), patch("engine.cli_analyzer.run_cli", side_effect=run):
            result = analyzer._run_request("Fixture", analyzer.settings, structured=True, response_schema=self.tools.decision_model.model_json_schema(), quant_mcp=capability)
        self.assertEqual(json.loads(result)["action"], "HOLD")
        self.assertTrue(all(not folder.exists() for folder in folders))

    def test_mcp_permission_failure_keeps_safe_tool_and_category(self):
        error = agy_step_error({"tool_name": "call_mcp_tool", "tool_info": {"error": {"message": "permission required, headless mode auto-denied, private credential fixture"}}})
        self.assertEqual(error.code, "mcp_permission")
        self.assertEqual(error.tool, "call_mcp_tool")
        self.assertNotIn("private credential fixture", error.safe_message)

    def test_empty_agy_success_reports_permission_denial_without_exposing_stderr(self):
        analyzer = CliLearningAnalyzer({"provider": "AGY"})
        result = SimpleNamespace(returncode=0, stdout=json.dumps({"event": "result", "result": {"status": "SUCCESS", "response": ""}}), stderr="MCP permission required, auto-denied; private fixture credential")
        with patch("engine.cli_analyzer.find_cli", return_value="agy.exe"), patch("engine.cli_analyzer.run_cli", return_value=result):
            with self.assertRaises(RuntimeError) as rejected:
                analyzer._run_request("Fixture", analyzer.settings, structured=True, response_schema=self.tools.decision_model.model_json_schema(), quant_mcp={"QUANT_MCP_PORT": "12345", "QUANT_MCP_CAPABILITY": "fixture"})
        self.assertEqual(rejected.exception.code, "mcp_permission")
        self.assertEqual(rejected.exception.tool, "call_mcp_tool")
        self.assertNotIn("private fixture credential", str(rejected.exception))

    def test_schema_diagnostic_is_fixed_text_without_raw_values(self):
        message = cli_failure("CODEX", 1, 'Invalid schema for response_format, model gpt-6-luna, private fixture token')
        self.assertIn("structured output schema", message)
        self.assertNotIn("private fixture token", message)
        self.assertNotIn("gpt-6-luna", message)

    def test_standard_mcp_request_metadata_is_accepted_without_relaxing_tool_arguments(self):
        result, initialized = dispatch({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "clientInfo": {"name": "fixture", "version": "1"}, "capabilities": {}, "_meta": {"progressToken": 1}}}, False)
        self.assertTrue(initialized)
        self.assertIn("result", result)
        result, _ = dispatch({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {"_meta": {"progressToken": 2}}}, initialized, lambda *_: {"tools": []})
        self.assertEqual(result["result"], {"tools": []})
        result, _ = dispatch({"jsonrpc": "2.0", "id": 3, "method": "ping", "params": {"_meta": "invalid"}}, initialized)
        self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
