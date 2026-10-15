import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.agy_replay import run_replay, definitions, TOOLS
from engine.backtest_mcp import QuantTools, QuantSessionError, serve_tools
from engine.cli_analyzer import CliLearningAnalyzer
from engine.cli_diagnostics import CliRequestError
from engine.cli_process import CliConversation, cli_environment, observer_workspace
from engine.observer_guard import decide
from engine.quant_mcp_route import load_route, write_route
from engine.quant_mcp_stdio import exchange, dispatch
from engine.backtest_agent import mcp_summary_schema
from engine.backtest_bridge import BacktestDecision
from test_backtest_bridge import frame, hold


class ConversationTests(unittest.TestCase):
    def test_child_never_inherits_another_request_binding(self):
        with patch.dict(os.environ, {"QUANT_MCP_ROUTE": "old-request", "QUANT_MCP_CAPABILITY": "old-capability", "QUANT_OBSERVER_MCP_TOOLS": "old-tools", "AGY_FIXTURE_OPTION": "preserved"}):
            environment = cli_environment()
        self.assertFalse(any(key.startswith(("QUANT_MCP_", "QUANT_OBSERVER_")) for key in environment))
        self.assertEqual(environment["AGY_FIXTURE_OPTION"], "preserved")

    def start(self, program, folder):
        stream = CliConversation([sys.executable, "-u", "-c", program], cwd=folder, text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.addCleanup(stream.close)
        return stream

    def test_two_real_turns_reuse_one_process_and_close_owned_workspace(self):
        program = "import sys,json\nfor line in sys.stdin:\n p=json.loads(line)['message']['content']; print(json.dumps({'event':'result','result':{'status':'SUCCESS','response':p}}),flush=True)"
        with observer_workspace() as folder:
            stream = self.start(program, folder)
            pid = stream.process.pid
            for prompt in ("first", "second"):
                result = stream.request(prompt, 5)
                self.assertEqual(json.loads(result.stdout)["result"]["response"], prompt)
                self.assertEqual(stream.process.pid, pid)
                self.assertIsNone(stream.process.poll())
            stream.close()
        self.assertIsNotNone(stream.process.poll())
        self.assertFalse(Path(folder).exists())

    def test_timeout_closes_process_and_releases_workspace(self):
        with observer_workspace() as folder:
            stream = self.start("import sys,time; sys.stdin.readline(); time.sleep(20)", folder)
            with self.assertRaises(subprocess.TimeoutExpired):
                stream.request("observation", .3)
            self.assertIsNotNone(stream.process.poll())
        self.assertFalse(Path(folder).exists())

    def test_malformed_stream_fails_without_waiting_for_process_exit(self):
        with observer_workspace() as folder:
            stream = self.start("import sys,time; sys.stdin.readline(); print('invalid',flush=True); time.sleep(20)", folder)
            with self.assertRaises(CliRequestError) as error:
                stream.request("observation", 5)
            self.assertEqual(error.exception.code, "stream_format")
            self.assertIsNotNone(stream.process.poll())

    def test_schema_repair_budget_resets_for_each_turn(self):
        error = {"event": "step_update", "step_update": {"tool_name": "finish", "state": "ERROR", "tool_info": {"error": "argument validation failed"}}}
        done = {"event": "result", "result": {"status": "SUCCESS"}}
        program = f"import sys,json\nfor line in sys.stdin:\n print({json.dumps(error)!r},flush=True); print({json.dumps(error)!r},flush=True); print({json.dumps(done)!r},flush=True)"
        with observer_workspace() as folder:
            stream = self.start(program, folder)
            try:
                for _ in range(2):
                    self.assertIn('"SUCCESS"', stream.request("observation", 5).stdout)
            finally:
                stream.close()
        self.assertFalse(Path(folder).exists())


class RequestBindingTests(unittest.TestCase):
    def test_previous_request_cannot_read_or_write_next_request(self):
        owners = [str(uuid.uuid4()), str(uuid.uuid4())]
        tools = [QuantTools(frame(client_id=owner), lambda: True) for owner in owners]
        with tempfile.TemporaryDirectory() as folder, serve_tools(tools[0]) as first, serve_tools(tools[1]) as second:
            route = Path(folder) / "route.json"
            catalog = definitions(first)
            for definition in catalog:
                self.assertIn("request_id", definition["inputSchema"]["required"])
                self.assertFalse(definition["inputSchema"]["additionalProperties"])

            def activate(index, capability):
                manifest = Path(folder) / ("quant-artifacts-" + owners[index] + ".json")
                manifest.write_text('{"entries":[]}', encoding="utf-8")
                write_route(route, {"version": 1, "active": True, "request_id": owners[index], "port": int(capability["QUANT_MCP_PORT"]), "capability": capability["QUANT_MCP_CAPABILITY"], "manifest": str(manifest), "expires": time.monotonic() + 5, "tools": catalog})

            with patch.dict(os.environ, {"QUANT_MCP_ROUTE": str(route)}):
                activate(0, first)
                response, _ = dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_chart_state", "arguments": {"request_id": owners[0]}}}, True)
                self.assertFalse(response["result"]["isError"])
                brain = Path(folder) / "brain"
                brain.mkdir()
                artifact = brain / "output.json"
                artifact.write_text(response["result"]["content"][0]["text"], encoding="utf-8")
                view = {"toolCall": {"name": "view_file", "args": {"AbsolutePath": str(artifact)}}}
                self.assertEqual(decide(view, [], "backtest", TOOLS, load_route(route)["manifest"], str(brain), owners[0])["decision"], "allow")
                activate(1, second)
                self.assertEqual(decide(view, [], "backtest", TOOLS, load_route(route)["manifest"], str(brain), owners[1])["decision"], "deny")
                for name, arguments in (("get_chart_state", {}), ("submit_order", {"action": "OPEN_LONG", "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "fixture"})):
                    with self.assertRaises(ValueError):
                        exchange("/call", {"name": name, "arguments": {**arguments, "request_id": owners[0]}})
                self.assertEqual(tools[1].calls, 0)
                self.assertIsNone(tools[1].pending)
                self.assertIn("data", exchange("/call", {"name": "get_chart_state", "arguments": {"request_id": owners[1]}}))
                write_route(route, {"version": 1, "active": False, "tools": catalog})
                self.assertEqual(len(exchange("/tools", {})["tools"]), 6)
                with self.assertRaises(ValueError):
                    exchange("/call", {"name": "get_chart_state", "arguments": {"request_id": owners[1]}})

    def test_guard_requires_current_request_on_tools_and_finish(self):
        owner = str(uuid.uuid4())
        for tool in ("get_chart_state", "submit_order"):
            args = {"ServerName": "quant-backtest_quant", "ToolName": tool, "Arguments": {"request_id": owner}}
            payload = {"toolCall": {"name": "call_mcp_tool", "args": args}}
            self.assertEqual(decide(payload, [], "backtest", [tool], request_id=owner)["decision"], "allow")
            args["Arguments"]["request_id"] = str(uuid.uuid4())
            self.assertEqual(decide(payload, [], "backtest", [tool], request_id=owner)["decision"], "deny")
        payload = {"toolCall": {"name": "finish", "args": hold(request_id=owner)}}
        self.assertEqual(decide(payload, [], "backtest", request_id=owner)["decision"], "allow")
        payload["toolCall"]["args"]["request_id"] = str(uuid.uuid4())
        self.assertEqual(decide(payload, [], "backtest", request_id=owner)["decision"], "deny")

    def test_expired_binding_is_rejected_before_transport(self):
        tools = QuantTools(frame(client_id=str(uuid.uuid4())), lambda: True)
        with tempfile.TemporaryDirectory() as folder, serve_tools(tools) as capability:
            route = Path(folder) / "route.json"
            owner = tools.owner
            write_route(route, {"version": 1, "active": True, "request_id": owner, "port": int(capability["QUANT_MCP_PORT"]), "capability": capability["QUANT_MCP_CAPABILITY"], "manifest": str(Path(folder) / ("quant-artifacts-" + owner + ".json")), "expires": time.monotonic() - 1, "tools": definitions(capability)})
            with self.assertRaises(ValueError):
                load_route(route, active=True)
            self.assertEqual(tools.calls, 0)

    def test_replay_generation_change_cannot_replace_active_frame(self):
        initial = frame(client_id=str(uuid.uuid4()), replay_id=str(uuid.uuid4()))
        tools = QuantTools(initial, lambda: True)
        with self.assertRaises(ValueError):
            tools.update(initial.model_copy(update={"replay_id": str(uuid.uuid4())}))
        self.assertIs(tools.frame, initial)


class ReplaySessionTests(unittest.TestCase):
    def setUp(self):
        self.analyzer = CliLearningAnalyzer({"provider": "AGY", "model": "fixture-model"})
        self.addCleanup(self.analyzer.close_replay)
        self.replay = str(uuid.uuid4())
        self.schema = mcp_summary_schema(BacktestDecision.model_json_schema())
        self.instances = []
        self.bad_result = self.timeout = False
        test = self

        class Stream:
            def __init__(self, command, **kwargs):
                self.route = kwargs["env"]["QUANT_MCP_ROUTE"]
                self.process = type("Process", (), {"pid": 100 + len(test.instances), "poll": lambda instance: None})()
                self.closed = False
                self.prompts = []
                test.instances.append(self)

            def request(self, prompt, timeout, on_output):
                self.prompts.append(prompt)
                if test.timeout:
                    raise subprocess.TimeoutExpired("fixture", timeout)
                owner = load_route(self.route, active=True)["request_id"]
                value = hold(request_id=str(uuid.uuid4()) if test.bad_result else owner)
                return subprocess.CompletedProcess([], 0, json.dumps({"event": "result", "result": {"status": "SUCCESS", "structured_output": value}}), "")

            def close(self):
                self.closed = True

        self.patch = patch("engine.agy_replay.CliConversation", Stream)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def observe(self, cutoff=60, replay=None, hashes=None, check=None):
        owner = str(uuid.uuid4())
        tools = QuantTools(frame(client_id=owner, replay_id=replay or self.replay, cutoff=cutoff), lambda: True)
        with serve_tools(tools) as capability:
            capability["_replay"] = {"id": replay or self.replay, "owner": owner, "symbol": "VN30F1M", "granularity": "1m", "cutoff": cutoff, "revision": 0, "hashes": hashes or [], "teaching": ""}
            capability["_turn_prompt"] = "current observation only"
            capability["_check"] = check or tools.check
            output = run_replay(self.analyzer, "fixture", "full trusted instructions", self.analyzer.settings, capability, self.schema, 5, None)
            return json.loads(output), owner

    def test_same_replay_reuses_process_but_rotates_capability_and_artifacts(self):
        first, owner = self.observe()
        self.assertNotIn("request_id", first)
        session = self.analyzer._agy_replay
        self.assertFalse(load_route(session.route)["active"])
        self.assertFalse((session.route.parent / ("quant-artifacts-" + owner + ".json")).exists())
        second, second_owner = self.observe(cutoff=120)
        self.assertEqual(second["action"], "HOLD")
        self.assertEqual(len(self.instances), 1)
        self.assertIs(self.analyzer._agy_replay, session)
        self.assertNotEqual(owner, second_owner)
        self.assertEqual(session.owner, second_owner)
        self.assertIn("full trusted instructions", self.instances[0].prompts[0])
        self.assertNotIn("full trusted instructions", self.instances[0].prompts[1])
        self.assertIn("current observation only", self.instances[0].prompts[1])

    def test_rewind_replay_or_strategy_change_closes_previous_process(self):
        self.observe(cutoff=120)
        self.observe(cutoff=60)
        self.assertTrue(self.instances[0].closed)
        next_replay = str(uuid.uuid4())
        self.observe(cutoff=120, replay=next_replay)
        self.assertTrue(self.instances[1].closed)
        self.observe(cutoff=180, replay=next_replay, hashes=["changed-strategy"])
        self.assertTrue(self.instances[2].closed)
        self.assertEqual(len(self.instances), 4)

    def test_result_from_previous_owner_closes_runtime_without_returning_decision(self):
        self.bad_result = True
        with self.assertRaises(CliRequestError):
            self.observe()
        self.assertIsNone(self.analyzer._agy_replay)
        self.assertTrue(self.instances[0].closed)

    def test_timeout_closes_runtime_without_retry(self):
        self.timeout = True
        with self.assertRaises(subprocess.TimeoutExpired):
            self.observe()
        self.assertEqual(len(self.instances), 1)
        self.assertTrue(self.instances[0].closed)
        self.assertIsNone(self.analyzer._agy_replay)

    def test_reset_during_initialization_prevents_prompt_submission(self):
        def cancelled():
            raise QuantSessionError("session_closed")
        with self.assertRaises(QuantSessionError):
            self.observe(check=cancelled)
        self.assertEqual(self.instances[0].prompts, [])
        self.assertTrue(self.instances[0].closed)

    def test_configuration_change_closes_idle_session(self):
        self.observe()
        self.analyzer.invalidate()
        self.assertTrue(self.instances[0].closed)
        self.assertIsNone(self.analyzer._agy_replay)

    def test_reset_for_different_owner_does_not_close_current_session(self):
        _, owner = self.observe()
        self.analyzer.close_replay(str(uuid.uuid4()))
        self.assertFalse(self.instances[0].closed)
        self.analyzer.close_replay(owner)
        self.assertTrue(self.instances[0].closed)
