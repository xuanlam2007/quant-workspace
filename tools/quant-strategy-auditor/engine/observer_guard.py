import json
import os
import sys
import importlib.util
from pathlib import Path


def decide(payload, allowed_paths, response_kind="observation", mcp_tools=(), artifact_manifest=None, artifact_root=None, request_id=None):
    call = payload.get("toolCall", {})
    arguments = call.get("args", {})
    if response_kind == "backtest" and mcp_tools and call.get("name") == "call_mcp_tool":
        server = arguments.get("ServerName")
        tool = arguments.get("ToolName")
        if server == "quant-backtest_quant" and tool in mcp_tools and arguments.keys() <= {"ServerName", "ToolName", "Arguments", "toolAction", "toolSummary"}:
            if request_id is not None:
                parameters = arguments.get("Arguments")
                try:
                    parameters = json.loads(parameters) if isinstance(parameters, str) else parameters
                except ValueError:
                    parameters = None
                if not isinstance(parameters, dict) or parameters.get("request_id") != request_id:
                    return {"decision": "deny", "reason": "Quant invalid_arguments: request_id. Correct the tool arguments using the current request_id."}
            return {"decision": "allow", "permissionOverrides": [f"mcp({server}/{tool})"], "reason": "Dispatch only the scoped Quant MCP tool"}
    if response_kind == "backtest" and call.get("name") == "finish":
        fields = {"action", "order_type", "stop_price", "limit_price", "reason", "question", "drawings"}
        extra = {"request_id"} if request_id is not None else set()
        if (request_id is None or arguments.get("request_id") == request_id) and fields <= arguments.keys() and arguments.keys() <= fields | {"toolAction", "toolSummary", "indicators"} | extra and arguments.get("action") in ("HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL") and arguments.get("order_type") in ("MARKET", "LIMIT", "STOP_LIMIT") and all(isinstance(arguments.get(key), str) for key in ("reason", "question")) and isinstance(arguments.get("drawings"), list) and len(arguments["drawings"]) <= 30 and isinstance(arguments.get("indicators", []), list) and len(arguments.get("indicators", [])) <= 10 and all(arguments.get(key) is None or type(arguments.get(key)) in (int, float) for key in ("stop_price", "limit_price")):
            return {"decision": "allow", "reason": "Return a simulated Backtest decision only"}
        return {"decision": "deny", "reason": "Invalid Backtest response"}
    if response_kind == "backtest" and mcp_tools:
        target = arguments.get("AbsolutePath")
        if call.get("name") == "view_file" and isinstance(target, str) and artifact_manifest and artifact_root:
            try:
                spec = importlib.util.spec_from_file_location("quant_artifact_guard", Path(__file__).with_name("quant_mcp_artifacts.py"))
                helper = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(helper)
                if helper.is_request_artifact(target, artifact_manifest, artifact_root):
                    return {"decision": "allow", "reason": "Read an authenticated Quant tool output from this request only"}
            except Exception:
                pass
        return {"decision": "deny", "reason": "QUANT_MCP_ONLY: Use scoped Quant tools and finish. view_file may read only authenticated MCP output artifacts. Workspace files and shell remain blocked."}
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
        binding = None
        if os.environ.get("QUANT_MCP_ROUTE"):
            spec = importlib.util.spec_from_file_location("quant_request_binding", Path(__file__).with_name("quant_mcp_route.py"))
            helper = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(helper)
            binding = helper.load_route(os.environ["QUANT_MCP_ROUTE"], active=True)
        result = decide(json.load(sys.stdin), json.loads(os.environ.get("QUANT_OBSERVER_MEDIA_PATHS", "[]")), os.environ.get("QUANT_OBSERVER_RESPONSE_KIND", "observation"), json.loads(os.environ.get("QUANT_OBSERVER_MCP_TOOLS", "[]")), binding["manifest"] if binding else os.environ.get("QUANT_MCP_ARTIFACT_MANIFEST"), os.environ.get("QUANT_MCP_ARTIFACT_ROOT"), binding["request_id"] if binding else None)
    except Exception:
        result = {"decision": "deny", "reason": "Invalid observer permission request"}
    print(json.dumps(result))
