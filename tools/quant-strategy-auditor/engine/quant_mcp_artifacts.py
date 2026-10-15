"""Authenticate CLI materializations of this request's Quant tool output."""
import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path

MAX_ARTIFACT = 12 * 1024 * 1024
TOOLS = frozenset(("get_chart_state", "get_account_state", "get_chart_catalog", "capture_chart", "apply_chart", "submit_order"))


def json_digest(value):
    def normalize(item):
        if isinstance(item, dict):
            return {key: normalize(value) for key, value in item.items()}
        if isinstance(item, list):
            return [normalize(value) for value in item]
        # CLI có thể đổi 100.0 thành 100 khi ghi JSON, nhưng giá trị không đổi.
        if type(item) is float and item.is_integer():
            return int(item)
        return item

    raw = json.dumps(normalize(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def register_result(tool, data, manifest=None):
    manifest = manifest or os.environ.get("QUANT_MCP_ARTIFACT_MANIFEST")
    if not manifest or tool not in TOOLS:
        return
    path = Path(manifest)
    raw = path.read_bytes()
    if len(raw) > 65536:
        raise ValueError("Invalid artifact registry")
    entries = json.loads(raw)["entries"]
    if not isinstance(entries, list) or len(entries) > 40:
        raise ValueError("Invalid artifact registry")
    content = {"cutoff": data["cutoff"]} if tool == "capture_chart" else data
    additions = [{"kind": "json", "digest": json_digest(content), "tool": tool}]
    if tool == "capture_chart":
        image = base64.b64decode(data["image"], validate=True)
        if len(image) > MAX_ARTIFACT or not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Invalid chart artifact")
        additions.append({"kind": "png", "digest": hashlib.sha256(image).hexdigest(), "tool": tool})
    for entry in additions:
        if entry not in entries:
            entries.append(entry)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix="quant-artifacts-", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump({"entries": entries[-40:]}, stream)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def is_request_artifact(target, manifest, artifact_root):
    try:
        root = Path(artifact_root).resolve(strict=True)
        path = Path(target).resolve(strict=True)
        if not path.is_relative_to(root) or path.suffix.lower() not in (".txt", ".json", ".png") or not path.is_file() or path.stat().st_size > MAX_ARTIFACT:
            return False
        registry = Path(manifest).read_bytes()
        if len(registry) > 65536:
            return False
        entries = json.loads(registry)["entries"]
        if not isinstance(entries, list) or len(entries) > 40:
            return False
        raw = path.read_bytes()
        if len(raw) > MAX_ARTIFACT:
            return False
        kind = "png" if path.suffix.lower() == ".png" else "json"
        if kind == "png":
            if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                return False
            digest = hashlib.sha256(raw).hexdigest()
        else:
            digest = json_digest(json.loads(raw))
        return any(isinstance(entry, dict) and set(entry) == {"kind", "digest", "tool"} and entry["kind"] == kind and entry["digest"] == digest and entry["tool"] in TOOLS for entry in entries)
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        return False
