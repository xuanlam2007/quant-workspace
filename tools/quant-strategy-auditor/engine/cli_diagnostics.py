import json
import re


SAFE_TOOLS = frozenset(("view_file", "finish", "run_command", "list_dir", "grep_search", "find_by_name", "task_boundary", "notify_user", "call_mcp_tool"))
MESSAGES = {
    "mcp_tool_policy": "Backtest permits only Quant MCP tools and finish. Use capture_chart for visual evidence; files and shell remain blocked.",
    "hook_configuration": "The evidence permission hook could not start. Check the local Python interpreter and retry.",
    "tool_denied": "The evidence permission hook rejected the requested tool or arguments. No order was applied.",
    "structured_output": "The structured decision could not be returned. Retry the current chart analysis.",
    "finish_failed": "The decision tool failed. No decision was applied; retry the current analysis.",
    "evidence_read": "The supplied chart or audio could not be read. Retry with a media-capable model.",
    "authentication": "CLI authentication failed. Sign in through Terminal and retry.",
    "usage_limit": "The provider usage limit was reached. Wait before retrying.",
    "model_unavailable": "The selected model is unavailable. Refresh the model catalog and check account access.",
    "network": "The CLI could not reach the provider. Check the connection and retry.",
    "final_result": "The CLI ended without a successful final result. Retry the current analysis.",
    "stream_format": "The CLI returned an invalid stream message. Check the installed CLI version.",
    "tool_step": "A CLI tool step failed. No decision was applied; retry the current analysis.",
    "mcp_permission": "The Quant MCP request was denied by the CLI permission policy. Restart the updated Backtest engine and retry.",
    "mcp_arguments": "The Quant MCP tool arguments did not match the schema. No chart change was applied.",
}


class CliRequestError(RuntimeError):
    def __init__(self, code, tool=None, fields=()):
        self.code = code if code in MESSAGES else "tool_step"
        self.tool = tool if isinstance(tool, str) and tool in SAFE_TOOLS else None
        self.safe_message = f"AGY{(' ' + self.tool) if self.tool else ''}: {MESSAGES[self.code]}"
        known = {"name", "arguments", "after_time", "limit", "indicator_name", "drawings", "indicators", "id", "tool", "points", "timestamp", "price", "label", "inputs", "visible", "operation", "value", "action", "order_type", "stop_price", "limit_price", "reason", "redacted"}
        safe_fields = [field for field in fields if isinstance(field, str) and len(field) <= 160 and all(part in known or part.isascii() and part.isdecimal() and len(part) <= 4 for part in field.split("."))][:6]
        if self.code == "mcp_arguments" and safe_fields:
            self.safe_message += " Fields: " + ", ".join(safe_fields) + "."
        super().__init__(self.safe_message)


def agy_step_error(step):
    info = step.get("tool_info") or {}
    if not isinstance(info, dict):
        return CliRequestError("stream_format")
    diagnostic = json.dumps(info.get("error") or step.get("error") or "", ensure_ascii=False, default=str).lower()
    tool = step.get("tool_name")
    # Chỉ trả mã lỗi và thông báo cố định, không đưa tool arguments hoặc stderr vào log.
    patterns = (
        ("usage_limit", ("rate limit", "resource_exhausted", "quota", "too many requests", "status 429")),
        ("authentication", ("unauthenticated", "unauthorized", "authentication", "token expired")),
        ("model_unavailable", ("unknown model", "invalid model", "model not supported", "model unavailable")),
        ("hook_configuration", ("can't open file", "no such file", "hook command", "pretooluse hook failed", "failed to execute hook")),
        ("tool_denied", ("permission denied", "not permitted", "rejected", "decision deny", "invalid backtest response", "invalid observer permission")),
        ("network", ("connection refused", "connection reset", "tls", "dns", "network")),
    )
    code = next((code for code, words in patterns if any(word in diagnostic for word in words)), None)
    if "quant_mcp_only:" in diagnostic:
        return CliRequestError("mcp_tool_policy", tool)
    if tool == "call_mcp_tool" and any(word in diagnostic for word in ("permission", "auto-denied", "headless mode", "approval")):
        code = "mcp_permission"
    elif tool == "call_mcp_tool" and "invalid_arguments" in diagnostic:
        code = "mcp_arguments"
    validation = ("schema", "validation", "invalid argument", "invalid parameter", "missing required", "type mismatch", "cannot unmarshal", "invalid backtest response")
    if tool == "call_mcp_tool" and (code is None or code == "tool_denied") and any(word in diagnostic for word in validation):
        code = "mcp_arguments"
    if tool == "finish" and (code is None or code == "tool_denied") and any(word in diagnostic for word in validation):
        code = "structured_output"
    if code is None:
        code = "finish_failed" if tool == "finish" else "evidence_read" if tool == "view_file" else "tool_step"
    fields = re.search(r"quant invalid_arguments: ([a-z_0-9., ]+)\. correct", diagnostic)
    return CliRequestError(code, tool, fields.group(1).split(", ") if fields else ())
