import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.ai_request_terminal import AiRequestTerminal, cli_failure
from engine.cli_analyzer import CliLearningAnalyzer
from engine.cli_process import run_cli
from engine.cli_diagnostics import CliRequestError, agy_step_error, agy_final_error


class AiRequestTerminalTests(unittest.TestCase):
    def test_failed_final_envelopes_keep_categories_without_provider_text(self):
        for diagnostic, expected in (("Unknown tool: call_mcp_tool private-token", "tool_configuration"), ("RESOURCE_EXHAUSTED quota private-token", "usage_limit"), ("unauthenticated private-token", "authentication"), ("unknown model private-token", "model_unavailable"), ("network connection refused private-token", "network"), ("unclassified private-token", "final_result")):
            result = {"status": "ERROR", "error": {"message": diagnostic}, "response": "private strategy"}
            self.assertEqual(agy_final_error(result).code, expected)
            analyzer = CliLearningAnalyzer({"provider": "AGY"})
            output = type("Result", (), {"returncode": 0, "stderr": "", "stdout": json.dumps({"event": "result", "result": result})})()
            with patch("engine.cli_analyzer.find_cli", return_value="agy.exe"), patch("engine.cli_analyzer.run_cli", return_value=output):
                with self.assertRaises(CliRequestError) as failure:
                    analyzer._run_request("Fixture", analyzer.settings)
            self.assertEqual(failure.exception.code, expected)
            self.assertNotIn("private-token", str(failure.exception))
            with tempfile.TemporaryDirectory() as folder:
                monitor = AiRequestTerminal("backtest", folder=folder)
                monitor.progress("stdout", {"event": "result", "result": result})
                saved = (Path(folder) / "current.jsonl").read_text(encoding="utf-8")
                self.assertIn(expected, saved)
                self.assertNotIn("private-token", saved)
                self.assertNotIn("private strategy", saved)

    def test_malformed_final_result_cannot_be_accepted_as_success(self):
        for value in (None, [], "SUCCESS"):
            self.assertEqual(agy_final_error(value).code, "final_result")

    def test_progress_stream_preserves_failure_and_diagnostic(self):
        output = []
        program = "import sys; sys.stdin.read(); print('{\"type\":\"thread.started\",\"thread_id\":\"session123\"}',flush=True); sys.stderr.write('model unavailable'); sys.exit(7)"
        result = run_cli([sys.executable, "-c", program], input="prompt", timeout=5, text=True, encoding="utf-8", on_output=lambda kind, line: output.append((kind, line)), creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stderr, "model unavailable")
        self.assertTrue(any(kind == "stdout" and "session123" in line for kind, line in output))

    def test_connection_probe_never_opens_an_analysis_viewer(self):
        analyzer = CliLearningAnalyzer({"provider": "CODEX"})
        analyzer.terminal = Mock()
        with patch.object(analyzer, "_run_request", return_value="PONG"):
            result = analyzer.test_connection()
        self.assertTrue(result["connected"])
        analyzer.terminal.begin.assert_not_called()

    def test_actual_backtest_schema_request_streams_without_second_ai_call(self):
        analyzer = CliLearningAnalyzer({"provider": "CODEX"})
        analyzer.terminal = Mock()
        schema = {"type": "object"}
        with patch.object(analyzer, "_run_request", return_value='{"action":"HOLD"}') as request:
            response = analyzer._run("strategy", analyzer.settings, structured=True, response_schema=schema)
        self.assertEqual(response, '{"action":"HOLD"}')
        request.assert_called_once()
        self.assertEqual(request.call_args.args[7], schema)
        analyzer.terminal.begin.assert_called_once_with(analyzer.settings)
        analyzer.terminal.write.assert_called_once_with("request.completed", result=response, truncated=False)

    def test_active_viewer_is_reused_and_only_current_request_retained(self):
        with tempfile.TemporaryDirectory() as folder:
            monitor = AiRequestTerminal("backtest", folder=folder)
            (Path(folder) / "viewer.heartbeat").touch()
            with patch("engine.ai_request_terminal.threading.Thread") as thread:
                monitor.begin({"provider": "CODEX"})
                monitor.write("request.completed", result="old decision")
                monitor.begin({"provider": "AGY", "model": "chosen"})
                thread.assert_not_called()
            content = (Path(folder) / "current.jsonl").read_text(encoding="utf-8")
            self.assertNotIn("old decision", content)
            self.assertIn('"AGY"', content)

    def test_progress_redacts_arbitrary_payloads_and_exposes_real_session_id(self):
        with tempfile.TemporaryDirectory() as folder:
            monitor = AiRequestTerminal("auditor", folder=folder)
            monitor.request_id = "request"
            monitor.progress("stdout", {"type": "thread.started", "thread_id": "session123", "token": "secret-value"})
            monitor.progress("stderr", "secret-value")
            monitor.progress("stdout", {"type": "item.completed", "item": {"type": "reasoning", "text": "private strategy"}})
            monitor.progress("stdout", {"type": "item.completed", "params": "unexpected"})
            content = (Path(folder) / "current.jsonl").read_text(encoding="utf-8")
            self.assertIn("session123", content)
            self.assertNotIn("secret-value", content)
            self.assertNotIn("private strategy", content)

    def test_cli_diagnostics_are_actionable_without_returning_secrets(self):
        for diagnostic, expected in (("401 secret-token", "authentication"), ("model not supported secret-token", "model or effort"), ("unexpected argument secret-token", "option"), ("unclassified secret-token", "No recognized diagnostic")):
            message = cli_failure("CODEX", 1, diagnostic)
            self.assertIn(expected, message)
            self.assertNotIn("secret-token", message)

    def test_terminal_launch_failure_does_not_replace_analysis_result(self):
        with tempfile.TemporaryDirectory() as folder:
            monitor = AiRequestTerminal("backtest", folder=folder)
            monitor.request_id = "request"
            with patch("engine.ai_request_terminal.subprocess.run", side_effect=FileNotFoundError("private/path")):
                monitor._launch()
            self.assertIn("Analysis can continue", monitor.error)
            self.assertNotIn("private/path", monitor.error)
            self.assertFalse(monitor.launching)

    def test_finish_diagnostic_logs_safe_category_without_arguments(self):
        with tempfile.TemporaryDirectory() as folder:
            monitor = AiRequestTerminal("backtest", folder=folder)
            monitor.progress("stdout", {"event": "step_update", "step_update": {"tool_name": "finish", "state": "ERROR", "tool_info": {"parameters": {"reason": "private strategy"}, "error": "schema validation failed secret-token C:/private/config"}}})
            content = (Path(folder) / "current.jsonl").read_text(encoding="utf-8")
            self.assertIn('"tool": "finish"', content)
            self.assertIn('"code": "structured_output"', content)
            for private in ("private strategy", "secret-token", "C:/private/config"):
                self.assertNotIn(private, content)

    def test_request_failure_keeps_safe_diagnostic(self):
        analyzer = CliLearningAnalyzer({"provider": "AGY"})
        analyzer.terminal = Mock()
        failure = CliRequestError("structured_output", "finish")
        with patch.object(analyzer, "_run_request", side_effect=failure), self.assertRaises(CliRequestError):
            analyzer._run("private prompt", analyzer.settings, structured=True)
        analyzer.terminal.write.assert_called_once_with("request.failed", code="structured_output", tool="finish", message=failure.safe_message)

    def test_provider_timeout_keeps_category_without_leaking_command_or_output(self):
        analyzer = CliLearningAnalyzer({"provider": "AGY"})
        analyzer.terminal = Mock()
        failure = subprocess.TimeoutExpired(["private-cli", "secret-token"], 120, output="private strategy", stderr="secret-token")
        with patch.object(analyzer, "_run_request", side_effect=failure), self.assertRaises(subprocess.TimeoutExpired):
            analyzer._run("private prompt", analyzer.settings, structured=True)
        diagnostic = CliRequestError("provider_timeout")
        analyzer.terminal.write.assert_called_once_with("request.failed", code="provider_timeout", tool=None, message=diagnostic.safe_message)
        for secret in ("private-cli", "secret-token", "private strategy"):
            self.assertNotIn(secret, str(analyzer.terminal.write.call_args))

    def test_unknown_tool_and_sensitive_errors_never_reach_diagnostic(self):
        failure = agy_step_error({"tool_name": "private-tool-name", "tool_info": {"error": "secret-token C:/private/config"}})
        self.assertIsNone(failure.tool)
        self.assertNotIn("secret-token", failure.safe_message)
        self.assertNotIn("private-tool-name", failure.safe_message)
