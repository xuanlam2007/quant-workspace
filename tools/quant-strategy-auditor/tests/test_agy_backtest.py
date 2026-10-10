import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.backtest_bridge import BacktestDecision
from engine.cli_analyzer import CliLearningAnalyzer
from engine.observer_guard import decide


class AgyBacktestTests(unittest.TestCase):
    def test_chart_read_and_backtest_schema_are_required(self):
        output = {"action": "HOLD", "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "Fixture", "question": "", "drawings": []}
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "chart.png"
            image.write_bytes(b"fixture image")
            def run(command, **kwargs):
                schema = json.loads(Path(command[command.index("--json-schema") + 1]).read_text())
                self.assertEqual(schema["required"], BacktestDecision.model_json_schema()["required"])
                self.assertNotIn("observation", schema["properties"])
                self.assertEqual(kwargs["env"]["QUANT_OBSERVER_RESPONSE_KIND"], "backtest")
                files = json.loads(kwargs["env"]["QUANT_OBSERVER_MEDIA_PATHS"])
                self.assertEqual(decide({"toolCall": {"name": "view_file", "args": {"AbsolutePath": files[0]}}}, files, "backtest")["decision"], "allow")
                self.assertEqual(decide({"toolCall": {"name": "finish", "args": output}}, files, "backtest")["decision"], "allow")
                events = [{"event": "step_update", "step_update": {"tool_name": "view_file", "state": "DONE", "tool_info": {"parameters": {"AbsolutePath": files[0]}}}}, {"event": "result", "result": {"status": "SUCCESS", "structured_output": output}}]
                return type("Result", (), {"returncode": 0, "stdout": "\n".join(json.dumps(event) for event in events)})()
            analyzer = CliLearningAnalyzer({"provider": "AGY"})
            with patch("engine.cli_analyzer.find_cli", return_value="agy.exe"), patch("engine.cli_analyzer.run_cli", side_effect=run):
                response = analyzer._run("Fixture", analyzer.settings, image=image, structured=True, response_schema=BacktestDecision.model_json_schema())
            self.assertEqual(BacktestDecision.model_validate_json(response).action, "HOLD")

    def test_backtest_finish_does_not_grant_external_tools_or_paths(self):
        output = {"action": "HOLD", "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "Fixture", "question": "", "drawings": []}
        for name in ("broker_order", "run_command", "browser", "publish"):
            self.assertEqual(decide({"toolCall": {"name": name, "args": output}}, [], "backtest")["decision"], "deny")
        self.assertEqual(decide({"toolCall": {"name": "finish", "args": {**output, "command": "trade"}}}, [], "backtest")["decision"], "deny")
        self.assertEqual(decide({"toolCall": {"name": "finish", "args": output}}, [])["decision"], "deny")
        self.assertEqual(decide({"toolCall": {"name": "view_file", "args": {"AbsolutePath": "config.json"}}}, [], "backtest")["decision"], "deny")


if __name__ == "__main__":
    unittest.main()
