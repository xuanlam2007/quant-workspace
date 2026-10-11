import os
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.cli_process import observer_workspace, run_cli
from engine.cli_diagnostics import CliRequestError


class CliProcessTests(unittest.TestCase):
    def child_command(self, hang=False):
        child = "import os,time; from pathlib import Path; Path('child-ready').write_text(str(os.getpid())); time.sleep(20)"
        parent = (
            "import subprocess,sys,time; from pathlib import Path; "
            f"subprocess.Popen([sys.executable,'-c',{child!r}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
            "deadline=time.monotonic()+5\n"
            "while not Path('child-ready').is_file() and time.monotonic()<deadline: time.sleep(.01)\n"
            "assert Path('child-ready').is_file(), 'Child did not start'\n"
            + ("time.sleep(20)" if hang else "print('complete')")
        )
        return [sys.executable, "-c", parent]

    def run_owned(self, folder, hang=False):
        return run_cli(self.child_command(hang), input="", cwd=folder, timeout=1 if hang else 8, text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    def test_success_releases_workspace_held_by_descendant(self):
        with observer_workspace() as folder:
            result = self.run_owned(folder)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "complete")
            self.assertTrue((Path(folder) / "child-ready").is_file())
        self.assertFalse(Path(folder).exists())

    def test_timeout_releases_parent_and_descendant_workspace(self):
        with observer_workspace() as folder:
            with self.assertRaises(subprocess.TimeoutExpired):
                self.run_owned(folder, hang=True)
        self.assertFalse(Path(folder).exists())

    def test_cleanup_lock_never_replaces_provider_failure(self):
        workspace = Mock(name="workspace")
        workspace.name = "isolated-workspace"
        workspace.cleanup.side_effect = PermissionError("temporary workspace locked")
        with patch("engine.cli_process.tempfile.TemporaryDirectory", return_value=workspace), patch("engine.cli_process.time.sleep"), self.assertLogs("engine.cli_process", level="WARNING"):
            with self.assertRaisesRegex(RuntimeError, "Actual provider failure"):
                with observer_workspace():
                    raise RuntimeError("Actual provider failure")

    def test_cleanup_lock_preserves_successful_response(self):
        workspace = Mock(name="workspace")
        workspace.name = "isolated-workspace"
        workspace.cleanup.side_effect = PermissionError("temporary workspace locked")
        def request():
            with observer_workspace():
                return "provider response"
        with patch("engine.cli_process.tempfile.TemporaryDirectory", return_value=workspace), patch("engine.cli_process.time.sleep"), self.assertLogs("engine.cli_process", level="WARNING"):
            self.assertEqual(request(), "provider response")

    def test_cli_exit_error_is_returned_with_original_diagnostic(self):
        with tempfile.TemporaryDirectory() as folder:
            result = run_cli([sys.executable, "-c", "import sys; sys.stderr.write('Audio unsupported'); sys.exit(2)"], input="", cwd=folder, timeout=5, text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "Audio unsupported")

    def test_stream_finishes_on_result_before_worker_exit(self):
        program = "import sys,time; sys.stdin.readline(); print('{\"event\":\"step_update\"}',flush=True); print('{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\"}}',flush=True); time.sleep(20)"
        with observer_workspace() as folder:
            result = run_cli([sys.executable, "-c", program], input='{"event":"user"}\n', timeout=5, terminal_event="result", cwd=folder, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0)
            self.assertIn('"SUCCESS"', result.stdout)
        self.assertFalse(Path(folder).exists())

    def test_stream_progress_without_result_times_out(self):
        program = "import sys,time; sys.stdin.readline(); print('{\"event\":\"step_update\"}',flush=True); time.sleep(20)"
        with observer_workspace() as folder:
            with self.assertRaises(subprocess.TimeoutExpired):
                run_cli([sys.executable, "-c", program], input='{"event":"user"}\n', timeout=1, terminal_event="result", cwd=folder, text=True, encoding="utf-8")
        self.assertFalse(Path(folder).exists())

    def test_hook_runs_from_directory_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix="quant observer ") as folder:
            root = Path(folder)
            guard_dir = root / ".agents"
            guard_dir.mkdir()
            shutil.copyfile(Path(__file__).resolve().parents[1] / "engine" / "observer_guard.py", guard_dir / "observer_guard.py")
            evidence = root / "voice.ogg"
            evidence.write_bytes(b"OggS")
            environment = {**os.environ, "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", ""), "QUANT_OBSERVER_MEDIA_PATHS": json.dumps([str(evidence)])}
            command = [Path(sys.executable).name, "-I", "observer_guard.py"]
            payload = json.dumps({"toolCall": {"name": "view_file", "args": {"AbsolutePath": str(evidence)}}})
            result = run_cli(command, input=payload, timeout=5, cwd=guard_dir, env=environment, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["decision"], "allow")

    def test_stream_tool_failure_does_not_wait_for_repeated_retries(self):
        program = "import sys,time; sys.stdin.readline(); print('{\"event\":\"step_update\",\"step_update\":{\"state\":\"ERROR\"}}',flush=True); time.sleep(20)"
        with observer_workspace() as folder:
            with self.assertRaisesRegex(CliRequestError, "tool step failed"):
                run_cli([sys.executable, "-c", program], input='{"event":"user"}\n', timeout=5, terminal_event="result", cwd=folder, text=True, encoding="utf-8")

    def run_stream(self, events):
        lines = "".join(json.dumps(event) + "\n" for event in events)
        program = f"import sys,time; sys.stdin.readline(); sys.stdout.write({lines!r}); sys.stdout.flush(); time.sleep(20)"
        with observer_workspace() as folder:
            return run_cli([sys.executable, "-c", program], input='{"event":"user"}\n', timeout=5, terminal_event="result", cwd=folder, text=True, encoding="utf-8")

    def failed_finish(self, diagnostic):
        return {"event": "step_update", "step_update": {"tool_name": "finish", "state": "ERROR", "tool_info": {"error": diagnostic}}}

    def test_finish_schema_error_can_be_corrected_in_same_stream(self):
        result = self.run_stream([self.failed_finish("argument validation failed"), self.failed_finish("Invalid Backtest response"), {"event": "result", "result": {"status": "SUCCESS", "structured_output": {"action": "HOLD"}}}])
        self.assertIn('"SUCCESS"', result.stdout)

    def test_finish_schema_repairs_are_bounded(self):
        with self.assertRaises(CliRequestError) as error:
            self.run_stream([self.failed_finish("schema validation failed")] * 3)
        self.assertEqual(error.exception.code, "structured_output")

    def test_finish_auth_and_permission_failures_are_not_retried(self):
        for diagnostic, code in (("unauthenticated", "authentication"), ("permission denied", "tool_denied"), ("quota exceeded", "usage_limit"), ("unexpected failure", "finish_failed")):
            with self.subTest(code=code), self.assertRaises(CliRequestError) as error:
                self.run_stream([self.failed_finish(diagnostic), {"event": "result", "result": {"status": "SUCCESS"}}])
            self.assertEqual(error.exception.code, code)

    def test_media_error_cannot_use_finish_repair_allowance(self):
        with self.assertRaises(CliRequestError) as error:
            self.run_stream([{"event": "step_update", "step_update": {"tool_name": "view_file", "state": "ERROR", "tool_info": {"error": "schema validation failed"}}}])
        self.assertEqual(error.exception.code, "evidence_read")

    def test_invalid_stream_shape_is_rejected(self):
        for event in ([], {"step_update": "invalid"}, {"step_update": {"tool_info": "invalid"}}):
            with self.subTest(event=event), self.assertRaises(CliRequestError) as error:
                self.run_stream([event])
            self.assertEqual(error.exception.code, "stream_format")
