import json
import os
import sys
from pathlib import Path


def decide(payload, allowed_paths):
    call = payload.get("toolCall", {})
    arguments = call.get("args", {})
    # finish chỉ trả kết quả có cấu trúc của CLI, không thực hiện hành động bên ngoài.
    if call.get("name") == "finish" and all(isinstance(arguments.get(key), str) for key in ("observation", "question", "evidence_limitations", "transcript")) and isinstance(arguments.get("strategy_difference"), bool) and isinstance(arguments.get("trade_observations"), list) and len(arguments["trade_observations"]) <= 20:
        return {"decision": "allow", "reason": "Return the structured observation response only"}
    target = arguments.get("AbsolutePath")
    if call.get("name") == "view_file" and isinstance(target, str):
        path = Path(target).resolve()
        if path in {Path(value).resolve() for value in allowed_paths} and path.is_file():
            return {"decision": "allow", "reason": "Read the supplied observation evidence only"}
    return {"decision": "deny", "reason": "The observation adapter permits only reading its supplied evidence files"}


if __name__ == "__main__":
    try:
        result = decide(json.load(sys.stdin), json.loads(os.environ.get("QUANT_OBSERVER_MEDIA_PATHS", "[]")))
    except Exception:
        result = {"decision": "deny", "reason": "Invalid observer permission request"}
    print(json.dumps(result))
