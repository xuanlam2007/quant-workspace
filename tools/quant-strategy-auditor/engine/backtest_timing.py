import json
from pathlib import Path

TIMING = json.loads((Path(__file__).resolve().parents[3] / "lib" / "backtest-timing.json").read_text(encoding="utf-8"))
ANALYSIS_TIMEOUT = TIMING["analysis_timeout_ms"] / 1000
REQUEST_LIFETIME = (TIMING["analysis_timeout_ms"] + TIMING["result_grace_ms"]) / 1000
COMMAND_ACK_TIMEOUT = TIMING["command_ack_timeout_ms"] / 1000
