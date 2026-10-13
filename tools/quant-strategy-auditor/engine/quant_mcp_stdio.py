"""Small tools-only MCP stdio transport. No account config or filesystem tools."""
import json
import os
import sys
import re
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

MAX_LINE = 256000
PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")


def exchange(path, body):
    port = int(os.environ["QUANT_MCP_PORT"])
    if not 1 <= port <= 65535 or path not in ("/tools", "/call"):
        raise ValueError("Invalid local Quant endpoint")
    request = Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body, allow_nan=False).encode(), headers={"Authorization": "Bearer " + os.environ["QUANT_MCP_CAPABILITY"], "Content-Type": "application/json"}, method="POST")
    with build_opener(ProxyHandler({})).open(request, timeout=30) as response:
        raw = response.read(12 * 1024 * 1024 + 1)
        if len(raw) > 12 * 1024 * 1024:
            raise ValueError("Quant response too large")
        return json.loads(raw)


def dispatch(message, initialized, call=exchange):
    request_id = message.get("id")
    if message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str) or set(message) - {"jsonrpc", "id", "method", "params"}:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32600, "message": "Invalid request"}}, initialized
    method = message["method"]
    if request_id is None:
        return None, initialized
    params = message.get("params", {})
    if isinstance(params, dict) and "_meta" in params:
        if not isinstance(params["_meta"], dict):
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "Invalid request metadata"}}, initialized
        params = {key: value for key, value in params.items() if key != "_meta"}
    if method == "initialize" and not initialized:
        if not isinstance(params, dict) or set(params) - {"protocolVersion", "capabilities", "clientInfo"} or not all(key in params for key in ("protocolVersion", "capabilities", "clientInfo")):
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "Invalid initialize parameters"}}, initialized
        result = {"protocolVersion": params["protocolVersion"] if params["protocolVersion"] in PROTOCOLS else PROTOCOLS[0], "capabilities": {"tools": {}}, "serverInfo": {"name": "quant-backtest", "version": "1.0.0"}}
        initialized = True
    elif not initialized:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": "Initialize first"}}, initialized
    elif method in ("ping", "tools/list") and params == {}:
        result = {} if method == "ping" else call("/tools", {})
    elif method == "tools/call" and isinstance(params, dict) and not set(params) - {"name", "arguments", "_meta"} and isinstance(params.get("name"), str) and isinstance(params.get("arguments", {}), dict):
        try:
            data = call("/call", {"name": params["name"], "arguments": params.get("arguments", {})})["data"]
            if params["name"] == "capture_chart":
                result = {"content": [{"type": "text", "text": json.dumps({"cutoff": data["cutoff"]})}, {"type": "image", "mimeType": "image/png", "data": data["image"]}], "isError": False}
            else:
                result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}], "isError": False}
        except HTTPError as error:
            message = "Quant tool rejected. Request expired or chart operation unavailable."
            try:
                detail = json.loads(error.read(8192))
                if error.code == 422 and detail.get("error") == "invalid_arguments":
                    fields = detail.get("fields", [])
                    fields = [field for field in fields if isinstance(field, str) and len(field) <= 160 and re.fullmatch(r"[a-z_0-9.]+", field)][:6]
                    message = "Quant invalid_arguments: " + ", ".join(fields) + ". Correct the tool arguments using its schema, then retry the tool."
                    hints = {"missing": "required field", "extra_forbidden": "remove unknown field", "list_type": "expected array", "dict_type": "expected object", "bool_type": "expected boolean", "int_type": "expected integer", "float_type": "expected number", "string_type": "expected string", "literal_error": "use schema enum", "string_pattern_mismatch": "use valid identifier", "value_error": "check catalog constraints", "invalid_value": "check schema limits"}
                    issues = detail.get("issues", [])
                    if isinstance(issues, list):
                        repairs = [item["field"] + ": " + hints[item["code"]] for item in issues[:6] if isinstance(item, dict) and item.get("field") in fields and isinstance(item.get("code"), str) and item["code"] in hints]
                        if repairs:
                            message += " " + "; ".join(repairs) + "."
            except (ValueError, TypeError, AttributeError):
                pass
            finally:
                error.close()
            result = {"content": [{"type": "text", "text": message}], "isError": True}
        except Exception:
            result = {"content": [{"type": "text", "text": "Quant tool rejected. Request expired, arguments invalid or chart operation unavailable."}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602 if method in ("ping", "tools/list", "tools/call") else -32601, "message": "Unsupported method or parameters"}}, initialized
    return {"jsonrpc": "2.0", "id": request_id, "result": result}, initialized


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    initialized = False
    while True:
        line = sys.stdin.buffer.readline(MAX_LINE + 1)
        if not line:
            return
        if len(line) > MAX_LINE:
            return
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("Expected object")
            response, initialized = dispatch(message, initialized)
        except Exception:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Invalid MCP message"}}
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
