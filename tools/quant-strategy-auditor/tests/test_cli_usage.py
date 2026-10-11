import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.cli_analyzer import CliLearningAnalyzer
from engine.cli_usage import RequestUsage


class CliUsageTests(unittest.TestCase):
    def test_codex_counts_are_not_duplicated_and_private_content_is_absent(self):
        with tempfile.TemporaryDirectory() as folder:
            usage = RequestUsage({"provider": "CODEX"}, "PRIVATE_STRATEGY", "backtest", "analysis", folder=folder)
            event = {"type": "turn.completed", "usage": {"input_tokens": 500, "cached_input_tokens": 300,
                     "output_tokens": 20, "input_tokens_details": {"secret": "PRIVATE_TOKEN"}}}
            usage.progress("stdout", event)
            usage.progress("stdout", event)
            usage.progress("stderr", "PRIVATE_TOKEN")
            usage.finish("completed", "PRIVATE_RESPONSE")
            usage.finish("completed")
            text = (Path(folder) / "backtest-summary.json").read_text()
            summary = json.loads(text)
            self.assertEqual(summary["requests"], 1)
            group = next(iter(summary["groups"].values()))
            self.assertEqual(group["tokens"]["input_tokens"], {"sum": 500, "reported_requests": 1})
            self.assertEqual(group["tokens"]["total_tokens"]["reported_requests"], 0)
            self.assertNotIn("PRIVATE", text)

    def test_agy_reports_only_explicit_valid_counts(self):
        with tempfile.TemporaryDirectory() as folder:
            usage = RequestUsage({"provider": "AGY"}, "x", "auditor", "analysis", folder=folder)
            usage.progress("stdout", {"event": "result", "result": {"usageMetadata": {
                "promptTokenCount": 120, "candidatesTokenCount": 15, "thoughtsTokenCount": 7,
                "cachedContentTokenCount": 0, "totalTokenCount": 142}}})
            usage.finish("completed")
            record = json.loads((Path(folder) / "auditor.jsonl").read_text())
            self.assertEqual(record["usage"]["total_tokens"], 142)
            self.assertEqual(record["usage"]["reasoning_tokens"], 7)
            self.assertEqual(record["usage"]["cached_input_tokens"], 0)

    def test_audio_last_snapshot_and_nested_details(self):
        usage = RequestUsage({"provider": "CODEX"}, "x", "auditor", "analysis")
        usage.progress("stdout", {"method": "thread/tokenUsage/updated", "params": {"tokenUsage": {
            "total": {"inputTokens": 9000}, "last": {"inputTokens": 100, "cachedInputTokens": 50}}}})
        self.assertEqual(usage.counts["input_tokens"], 100)
        usage.progress("stdout", {"type": "turn.completed", "usage": {"output_tokens": 10,
            "output_tokens_details": {"reasoning_tokens": 8}}})
        self.assertEqual(usage.counts["reasoning_tokens"], 8)

    def test_missing_or_invalid_usage_is_unknown_not_zero(self):
        with tempfile.TemporaryDirectory() as folder:
            usage = RequestUsage({"provider": "AGY"}, "x", "backtest", "analysis", folder=folder)
            for event in ("not json", [], {"event": "result", "result": "bad"},
                          {"type": "turn.completed", "usage": {"input_tokens": True, "output_tokens": -1,
                           "total_tokens": "100", "cached_input_tokens": 10**15}}):
                usage.progress("stdout", event)
            usage.finish("failed")
            summary = json.loads((Path(folder) / "backtest-summary.json").read_text())
            self.assertTrue(all(value is None for value in summary["last_request"]["usage"].values()))
            self.assertEqual(next(iter(summary["groups"].values()))["reported_requests"], 0)

    def test_storage_failure_cannot_fail_an_ai_request(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "file"
            root.write_text("occupied")
            usage = RequestUsage({"provider": "CODEX"}, "x", "backtest", "analysis", folder=root)
            usage.finish("completed")

    def test_rotation_preserves_summary(self):
        with tempfile.TemporaryDirectory() as folder:
            for index in range(2):
                if index:
                    (Path(folder) / "backtest.jsonl").write_text("x" * (2 * 1024 * 1024 + 1))
                usage = RequestUsage({"provider": "CODEX"}, "x", "backtest", "analysis", folder=folder)
                usage.finish("completed")
            self.assertTrue((Path(folder) / "backtest.previous.jsonl").exists())
            self.assertEqual(json.loads((Path(folder) / "backtest-summary.json").read_text())["requests"], 2)

    def test_one_provider_call_records_failure_without_changing_error(self):
        with tempfile.TemporaryDirectory() as folder, patch("engine.cli_usage.USAGE_FOLDER", Path(folder)):
            analyzer = CliLearningAnalyzer({"provider": "CODEX"})
            failure = subprocess.TimeoutExpired("PRIVATE_COMMAND", 120)
            with patch.object(analyzer, "_run_request", side_effect=failure) as request:
                with self.assertRaises(subprocess.TimeoutExpired):
                    analyzer._run("PRIVATE_PROMPT", analyzer.settings, structured=True)
            request.assert_called_once()
            record = json.loads((Path(folder) / "auditor.jsonl").read_text())
            self.assertEqual(record["status"], "failed")
            self.assertNotIn("PRIVATE", json.dumps(record))

    def test_usage_observer_preserves_existing_progress_callback(self):
        with tempfile.TemporaryDirectory() as folder, patch("engine.cli_usage.USAGE_FOLDER", Path(folder)):
            analyzer = CliLearningAnalyzer({"provider": "CODEX"})
            def run(*args):
                args[9]("stdout", {"type": "turn.completed", "usage": {"input_tokens": 40}})
                return "PONG"
            with patch.object(analyzer, "_run_request", side_effect=run):
                self.assertEqual(analyzer._run("Ping", analyzer.settings), "PONG")
            record = json.loads((Path(folder) / "auditor.jsonl").read_text())
            self.assertEqual(record["kind"], "connection")
            self.assertEqual(record["usage"]["input_tokens"], 40)
