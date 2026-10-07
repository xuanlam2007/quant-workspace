import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


class StrategyBackendContractTests(unittest.TestCase):
    def test_missing_extension_reports_unavailable_and_preserves_recording_contract(self):
        path = Path(__file__).resolve().parents[1] / "engine" / "strategy_backend.py"
        spec = importlib.util.spec_from_file_location("public_strategy_contract", path)
        module = importlib.util.module_from_spec(spec)
        with patch.object(Path, "is_file", return_value=False):
            spec.loader.exec_module(module)
        auditor = module.StrategyConflictAuditor({})
        self.assertEqual(auditor.audit("CLICK"), [])
        self.assertEqual(auditor.audit("TRADE_OPEN")[0]["type"], "STRATEGY_UNAVAILABLE")
        self.assertEqual(auditor.trade_count, 1)
        auditor.reset()
        self.assertEqual(auditor.trade_count, 0)
        auditor.enabled = False
        self.assertEqual(auditor.audit("TRADE_OPEN"), [])
        self.assertIsNone(module.build_analysis_prompt({}))


if __name__ == "__main__":
    unittest.main()
