import hmac
import json
import os
import re
import time
import tempfile
from pathlib import Path

TOOLS = frozenset(("get_chart_state", "get_account_state", "get_chart_catalog", "capture_chart", "apply_chart", "submit_order"))
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def load_route(filename, active=False):
    path = Path(filename)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 256000:
        raise ValueError("Invalid Quant request binding")
    raw = path.read_bytes()
    if len(raw) > 256000:
        raise ValueError("Invalid Quant request binding")
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("version") != 1 or type(value.get("active")) is not bool:
        raise ValueError("Invalid Quant request binding")
    definitions = value.get("tools")
    if not isinstance(definitions, list) or len(definitions) != len(TOOLS) or {item.get("name") for item in definitions if isinstance(item, dict)} != TOOLS:
        raise ValueError("Invalid Quant tool registry")
    if active:
        if not value["active"] or not UUID.fullmatch(value.get("request_id", "")) or type(value.get("port")) is not int or not 1 <= value["port"] <= 65535 or not isinstance(value.get("capability"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,100}", value["capability"]):
            raise ValueError("Quant request is inactive")
        if type(value.get("expires")) not in (int, float) or not time.monotonic() < value["expires"] < time.monotonic() + 180:
            raise ValueError("Quant request expired")
        manifest = Path(value.get("manifest", ""))
        if manifest.is_symlink() or manifest.parent.resolve() != path.parent.resolve() or manifest.name != "quant-artifacts-" + value["request_id"] + ".json":
            raise ValueError("Invalid Quant artifact binding")
    return value


def matches_request(value, request_id):
    return isinstance(request_id, str) and hmac.compare_digest(value["request_id"], request_id)


def write_route(filename, value):
    path = Path(filename)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix="quant-route-", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
