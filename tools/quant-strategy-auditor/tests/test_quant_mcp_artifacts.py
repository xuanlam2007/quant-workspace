import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import quant_mcp_artifacts as artifacts
from engine.observer_guard import decide
from engine.quant_mcp_stdio import dispatch


class QuantArtifactTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.root = self.directory / "brain"
        self.root.mkdir()
        self.manifest = self.directory / "quant-artifacts.json"
        self.manifest.write_text('{"entries":[]}', encoding="utf-8")
        environment = patch.dict(os.environ, {"QUANT_MCP_ARTIFACT_MANIFEST": str(self.manifest)})
        environment.start()
        self.addCleanup(environment.stop)
        self.data = {"bars": [[60, 100.0, 101, 99, 100, 10]], "label": "Hỗ trợ"}
        self.target = self.root / "tool-output.txt"
        self.target.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")

    def allowed(self, target=None, manifest=None):
        return artifacts.is_request_artifact(target or self.target, manifest or self.manifest, self.root)

    def test_json_materialization_preserves_semantics_across_formatting(self):
        artifacts.register_result("get_chart_state", self.data)
        self.assertTrue(self.allowed())
        self.target.write_text('{"label":"Hỗ trợ", "bars":[[60,100,101.0,99,100,10]]}', encoding="utf-8")
        self.assertTrue(self.allowed())
        for changed in ({**self.data, "label": "Kháng cự"}, {**self.data, "bars": [[60, 100.01, 101, 99, 100, 10]]}, {"bars": self.data["bars"]}, {**self.data, "extra": True}):
            self.target.write_text(json.dumps(changed), encoding="utf-8")
            self.assertFalse(self.allowed())

    def test_capture_authenticates_exact_png_and_emitted_metadata(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/6kAAAAASUVORK5CYII=")
        artifacts.register_result("capture_chart", {"cutoff": 120, "image": base64.b64encode(png).decode()})
        image = self.root / "chart.png"
        image.write_bytes(png)
        self.assertTrue(self.allowed(image))
        image.write_bytes(png + b"changed")
        self.assertFalse(self.allowed(image))
        self.target.write_text('{"cutoff":120}', encoding="utf-8")
        self.assertTrue(self.allowed())

    def test_other_request_and_unregistered_content_are_denied(self):
        self.assertFalse(self.allowed())
        artifacts.register_result("get_chart_state", self.data)
        other = self.directory / "other-request.json"
        other.write_text('{"entries":[]}', encoding="utf-8")
        self.assertFalse(self.allowed(manifest=other))
        unrelated = self.root / "unrelated.txt"
        unrelated.write_text('{"private":"unregistered"}', encoding="utf-8")
        self.assertFalse(self.allowed(unrelated))

    def test_matching_content_outside_root_or_wrong_extension_is_denied(self):
        artifacts.register_result("get_chart_state", self.data)
        for target in (self.directory / "workspace.json", self.root / "output.py"):
            shutil.copyfile(self.target, target)
            self.assertFalse(self.allowed(target))

    def test_symlink_cannot_escape_artifact_root(self):
        artifacts.register_result("get_chart_state", self.data)
        outside = self.directory / "outside.txt"
        shutil.copyfile(self.target, outside)
        link = self.root / "link.txt"
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest("Symbolic links unavailable for this Windows account")
        self.assertFalse(self.allowed(link))

    def test_missing_corrupt_and_oversized_inputs_fail_closed(self):
        artifacts.register_result("get_chart_state", self.data)
        self.assertFalse(self.allowed(self.root / "missing.txt"))
        for raw in ('not json', '{}', '{"entries":null}', '{"entries":[{}]}', '{"entries":' + json.dumps([{}] * 41) + '}', ' ' * 65537):
            self.manifest.write_text(raw, encoding="utf-8")
            self.assertFalse(self.allowed())
        self.manifest.unlink()
        self.assertFalse(self.allowed())
        self.manifest.write_text('{"entries":[]}', encoding="utf-8")
        artifacts.register_result("get_chart_state", self.data)
        self.target.write_text('not json', encoding="utf-8")
        self.assertFalse(self.allowed())
        with self.target.open("wb") as stream:
            stream.truncate(artifacts.MAX_ARTIFACT + 1)
        self.assertFalse(self.allowed())

    def test_registry_contains_only_bounded_hashes_and_registered_tool_names(self):
        artifacts.register_result("get_chart_state", self.data)
        artifacts.register_result("get_chart_state", self.data)
        first = self.manifest.read_text()
        self.assertEqual(len(json.loads(first)["entries"]), 1)
        for secret in ("Hỗ trợ", "bars", str(self.root), str(self.target)):
            self.assertNotIn(secret, first)
        artifacts.register_result("arbitrary_tool", self.data)
        self.assertEqual(self.manifest.read_text(), first)
        for cutoff in range(45):
            artifacts.register_result("get_chart_state", {"cutoff": cutoff})
        entries = json.loads(self.manifest.read_text())["entries"]
        self.assertEqual(len(entries), 40)
        for entry in entries:
            self.assertEqual(set(entry), {"kind", "digest", "tool"})
            self.assertRegex(entry["digest"], r"^[a-f0-9]{64}$")

    def test_stdio_registers_successful_output_only(self):
        message = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_chart_state", "arguments": {}}}
        result, _ = dispatch(message, True, lambda *args: {"data": self.data})
        self.assertFalse(result["result"]["isError"])
        self.assertTrue(self.allowed())
        self.manifest.write_text('{"entries":[]}', encoding="utf-8")
        def rejected(*args):
            raise HTTPError("http://127.0.0.1", 409, "Rejected", {}, io.BytesIO(b'{}'))
        result, _ = dispatch(message, True, rejected)
        self.assertTrue(result["result"]["isError"])
        self.assertFalse(self.allowed())
        self.assertEqual(json.loads(self.manifest.read_text()), {"entries": []})

    def test_guard_permits_only_authenticated_outputs_in_quant_mode(self):
        artifacts.register_result("get_chart_state", self.data)
        payload = {"toolCall": {"name": "view_file", "args": {"AbsolutePath": str(self.target)}}}
        scoped = ([], "backtest", ("get_chart_state",), str(self.manifest), str(self.root))
        self.assertEqual(decide(payload, *scoped)["decision"], "allow")
        self.assertEqual(decide(payload, [], "backtest", ("get_chart_state",))["decision"], "deny")
        self.target.write_text('{"private":"changed"}', encoding="utf-8")
        self.assertEqual(decide(payload, *scoped)["decision"], "deny")
        self.assertEqual(decide({"toolCall": {"name": "run_command", "args": {}}}, *scoped)["decision"], "deny")
        self.assertEqual(decide(payload, [], "observation", (), str(self.manifest), str(self.root))["decision"], "deny")
        self.assertEqual(decide(payload, [str(self.target)], "observation")["decision"], "allow")

    def test_isolated_hook_loads_adjacent_helper(self):
        artifacts.register_result("get_chart_state", self.data)
        engine = Path(__file__).resolve().parents[1] / "engine"
        for name in ("observer_guard.py", "quant_mcp_artifacts.py"):
            shutil.copyfile(engine / name, self.directory / name)
        environment = {**os.environ, "QUANT_OBSERVER_RESPONSE_KIND": "backtest", "QUANT_OBSERVER_MCP_TOOLS": '["get_chart_state"]', "QUANT_MCP_ARTIFACT_ROOT": str(self.root)}
        payload = {"toolCall": {"name": "view_file", "args": {"AbsolutePath": str(self.target)}}}
        result = subprocess.run([sys.executable, "-I", "observer_guard.py"], cwd=self.directory, env=environment, input=json.dumps(payload), capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.assertEqual(json.loads(result.stdout)["decision"], "allow")
