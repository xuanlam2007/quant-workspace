import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_local_backend():
    path = Path(__file__).resolve().parents[3] / "private" / "automation" / "strategy_backend.py"
    if not path.is_file():
        return None
    name = "quant_workspace_local_strategy"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Local strategy backend cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    if not callable(getattr(module, "StrategyConflictAuditor", None)) or not callable(getattr(module, "build_analysis_prompt", None)):
        sys.modules.pop(name, None)
        raise RuntimeError("Local strategy backend does not implement the required interface")
    return module


class UnconfiguredStrategyAuditor:
    def __init__(self, guardrails: Dict[str, Any], enabled: bool = True):
        self.guardrails = guardrails
        self.enabled = enabled
        self.trade_count = 0

    def reset(self):
        self.trade_count = 0

    def audit(self, event_type, action=None, price=None, current_dt=None):
        if not self.enabled or event_type not in ("TRADE_OPEN", "TRADE_CLOSE", "TRADE_MANUAL"):
            return []
        self.trade_count += 1
        return [{"type": "STRATEGY_UNAVAILABLE", "severity": "high", "message": "Strategy auditing is not configured in this installation."}]


_backend = _load_local_backend()
StrategyConflictAuditor = _backend.StrategyConflictAuditor if _backend else UnconfiguredStrategyAuditor


def build_analysis_prompt(context):
    return _backend.build_analysis_prompt(context) if _backend else None
