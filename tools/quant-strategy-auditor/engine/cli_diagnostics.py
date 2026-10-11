import json


SAFE_TOOLS = frozenset(("view_file", "finish", "run_command", "list_dir", "grep_search", "find_by_name", "task_boundary", "notify_user"))
MESSAGES = {
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
}


class CliRequestError(RuntimeError):
    def __init__(self, code, tool=None):
        self.code = code if code in MESSAGES else "tool_step"
        self.tool = tool if isinstance(tool, str) and tool in SAFE_TOOLS else None
        self.safe_message = f"AGY{(' ' + self.tool) if self.tool else ''}: {MESSAGES[self.code]}"
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
    validation = ("schema", "validation", "invalid argument", "invalid parameter", "missing required", "type mismatch", "cannot unmarshal", "invalid backtest response")
    if tool == "finish" and (code is None or code == "tool_denied") and any(word in diagnostic for word in validation):
        code = "structured_output"
    if code is None:
        code = "finish_failed" if tool == "finish" else "evidence_read" if tool == "view_file" else "tool_step"
    return CliRequestError(code, tool)
