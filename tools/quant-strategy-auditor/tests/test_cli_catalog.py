import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.cli_catalog import agy_catalog, codex_models, discover_catalog, list_options, separate_agy_presets
from engine.cli_analyzer import CliLearningAnalyzer


class CliCatalogTests(unittest.TestCase):
    def test_agy_discovers_model_presets_without_agent_or_effort_queries(self):
        def run(command, **kwargs):
            self.assertEqual(command, ["agy", "models"])
            output = "Fetching available models...\nfuture-model\tFuture Model (High)\nother-model\tOther Model\n"
            return type("Result", (), {"returncode": 0, "stdout": output})()
        with patch("engine.cli_catalog.subprocess.run", side_effect=run) as command:
            catalog = agy_catalog("agy", ".")
        command.assert_called_once()
        self.assertEqual(catalog["models"], [{"id": "future-model", "label": "Future Model (High)"}, {"id": "other-model", "label": "Other Model"}])
        self.assertEqual(catalog["agents"], [])
        self.assertEqual(catalog["efforts"], [])
        self.assertFalse(catalog["agents_supported"])

    def test_agy_failed_discovery_does_not_invent_options(self):
        result = type("Result", (), {"returncode": 1, "stdout": ""})()
        with patch("engine.cli_catalog.subprocess.run", return_value=result):
            catalog = agy_catalog("agy", ".")
        self.assertEqual(catalog["models"], [])
        self.assertEqual(catalog["agents"], [])
        self.assertEqual(catalog["efforts"], [])
        self.assertEqual(set(catalog["errors"]), {"models"})

    def test_agy_efforts_are_separated_from_matching_native_variants_only(self):
        output = "future-low\tFuture Model (Low)\nfuture-high\tFuture Model (High)\nsolo-thinking\tSolo Model (Thinking)\nother-thinking\tOther Model (Thinking)\nfixed-medium\tFixed Model (Medium)"
        result = type("Result", (), {"returncode": 0, "stdout": output})()
        with patch("engine.cli_catalog.subprocess.run", return_value=result):
            models = agy_catalog("agy", ".")["models"]
        self.assertEqual([item["id"] for item in models], ["future-low", "future-high", "solo-thinking", "other-thinking", "fixed-medium"])
        self.assertEqual(models[0]["preset_group"], {"id": "future-low", "label": "Future Model"})
        self.assertEqual(models[1]["preset_group"], models[0]["preset_group"])
        self.assertEqual([item["preset_effort"] for item in models[:2]], ["Low", "High"])
        for item in models[2:]:
            self.assertNotIn("preset_group", item)
            self.assertNotIn("preset_effort", item)

    def test_unrelated_parentheses_and_ambiguous_variants_are_not_grouped(self):
        for output in (
            "one-low\tSame Name (Low)\ntwo-high\tSame Name (High)",
            "preset\tSame Name (Low)\npreset-high\tSame Name (High)",
            "same-low\tSame Name (Low)\nsame-low-copy\tSame Name (Low)",
        ):
            with self.subTest(output=output):
                models = separate_agy_presets(list_options(output))
                self.assertTrue(all("preset_group" not in item for item in models))

    def test_saved_legacy_overrides_do_not_change_agy_model_presets(self):
        analyzer = CliLearningAnalyzer({"provider": "AGY", "model": "preset-model", "agent": "legacy", "effort": "high"})
        self.assertEqual(analyzer.settings["model"], "preset-model")
        self.assertEqual(analyzer.settings["agent"], "")
        self.assertEqual(analyzer.settings["effort"], "")

    def test_codex_model_specific_efforts_and_labels_come_from_native_catalog(self):
        source = [{"model": "future-model", "displayName": "Future Model", "isDefault": True, "defaultReasoningEffort": "future", "supportedReasoningEfforts": [{"reasoningEffort": "future", "description": "New effort"}]}, {"model": "hidden", "hidden": True}]
        with patch("engine.cli_catalog.codex_models", return_value=source):
            catalog = discover_catalog("CODEX", "codex")
        self.assertEqual(len(catalog["models"]), 1)
        self.assertEqual(catalog["models"][0]["efforts"][0]["id"], "future")
        self.assertEqual(catalog["models"][0]["default_effort"], "future")
        self.assertEqual(catalog["models"][0]["label"], "Future Model")
        self.assertFalse(catalog["agents_supported"])

    def test_failed_or_missing_codex_catalog_has_no_static_fallback(self):
        self.assertTrue(discover_catalog("CODEX", None)["errors"])
        with patch("engine.cli_catalog.codex_models", side_effect=RuntimeError("Sign in")):
            catalog = discover_catalog("CODEX", "codex")
        self.assertEqual(catalog["models"], [])
        self.assertEqual(catalog["errors"]["models"], "Sign in")

    def test_native_catalog_paginates_without_starting_an_ai_turn_and_closes_own_process(self):
        events = [{"id": 1, "result": {}}, {"id": 2, "result": {"required": False}}, {"id": 3, "result": {"data": [{"model": "first"}], "nextCursor": "next"}}, {"id": 4, "result": {"data": [{"model": "second"}], "nextCursor": None}}]

        class Process:
            def __init__(self):
                self.stdin = io.StringIO()
                self.stdout = io.StringIO("\n".join(json.dumps(event) for event in events))
                self.terminated = False
                self.commands = []

            def poll(self):
                return None

            def terminate(self):
                self.terminated = True
                self.commands = [json.loads(line) for line in self.stdin.getvalue().splitlines()]

            def wait(self, timeout):
                return 0

        process = Process()
        with patch("engine.cli_catalog.subprocess.Popen", return_value=process):
            models = codex_models("codex", ".")
        self.assertEqual([item["model"] for item in models], ["first", "second"])
        self.assertEqual([item["method"] for item in process.commands], ["initialize", "initialized", "account/gatewayOAuth/read", "model/list", "model/list"])
        self.assertEqual(process.commands[-1]["params"]["cursor"], "next")
        self.assertTrue(process.terminated)
        self.assertTrue(process.stdout.closed)

    def test_catalog_cache_refresh_and_account_invalidation(self):
        analyzer = CliLearningAnalyzer()
        source = {"models": [], "errors": {}}
        with patch("engine.cli_analyzer.find_cli", return_value="cli"), patch("engine.cli_analyzer.discover_catalog", return_value=source) as discover:
            analyzer.catalog("AGY")
            analyzer.catalog("AGY")
            self.assertEqual(discover.call_count, 1)
            analyzer.catalog("AGY", refresh=True)
            self.assertEqual(discover.call_count, 2)
            analyzer.invalidate()
            analyzer.catalog("AGY")
            self.assertEqual(discover.call_count, 3)

    def test_discovery_invalidated_mid_request_cannot_publish_old_choices(self):
        analyzer = CliLearningAnalyzer()
        def discover(*args):
            analyzer.invalidate()
            return {"models": [{"id": "old-account-model"}]}
        with patch("engine.cli_analyzer.find_cli", return_value="cli"), patch("engine.cli_analyzer.discover_catalog", side_effect=discover):
            catalog = analyzer.catalog("AGY")
        self.assertEqual(catalog["models"], [])
        self.assertTrue(catalog["errors"])


if __name__ == "__main__":
    unittest.main()
