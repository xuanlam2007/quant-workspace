import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


USAGE_FOLDER = Path(__file__).resolve().parents[3] / ".agents" / "ai-usage"
_LOCK = threading.Lock()
_FIELDS = {
    "input_tokens": ("input_tokens", "inputTokens", "prompt_tokens", "promptTokenCount"),
    "output_tokens": ("output_tokens", "outputTokens", "completion_tokens", "candidatesTokenCount"),
    "cached_input_tokens": ("cached_input_tokens", "cachedInputTokens", "cached_tokens", "cachedContentTokenCount"),
    "reasoning_tokens": ("reasoning_tokens", "reasoningOutputTokens", "thoughtsTokenCount"),
    "total_tokens": ("total_tokens", "totalTokens", "totalTokenCount"),
}


def _label(value):
    return value if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_.:/-]{1,100}", value) else "CLI default"


def _counts(usage):
    if not isinstance(usage, dict):
        return {}
    result = {}
    for field, names in _FIELDS.items():
        for name in names:
            value = usage.get(name)
            if type(value) is int and 0 <= value <= 10**12:
                result[field] = value
                break
    for name in ("input_tokens_details", "prompt_tokens_details", "output_tokens_details"):
        details = usage.get(name)
        if isinstance(details, dict):
            for field in ("cached_input_tokens", "reasoning_tokens"):
                for alias in _FIELDS[field]:
                    value = details.get(alias)
                    if type(value) is int and 0 <= value <= 10**12:
                        result[field] = value
                        break
    return result


class RequestUsage:
    def __init__(self, settings, prompt, scope, kind, image=None, audio=None, frames=None, folder=None):
        self.folder = Path(folder) if folder else USAGE_FOLDER
        self.started = time.monotonic()
        self.counts = {}
        self.source = None
        self.finished = False
        paths = {str(path) for path in [image, *(frame.get("path") for frame in frames or [])] if path}
        self.record = {
            "request": uuid4().hex, "started_at": datetime.now(timezone.utc).isoformat(),
            "scope": scope if scope in ("backtest", "auditor") else "auditor",
            "kind": kind, "provider": settings["provider"],
            "model": _label(settings.get("model")), "effort": _label(settings.get("effort")),
            "prompt_utf8_bytes": len(prompt.encode("utf-8")), "image_count": len(paths),
            "audio_present": bool(audio),
        }

    def progress(self, kind, line):
        if kind != "stdout":
            return
        try:
            event = json.loads(line) if isinstance(line, str) else line
        except (ValueError, TypeError):
            return
        if not isinstance(event, dict):
            return
        name = event.get("type") or event.get("event") or event.get("method")
        usage = None
        if name == "turn.completed":
            usage = event.get("usage")
        elif name == "result" and isinstance(event.get("result"), dict):
            result = event["result"]
            usage = result.get("usage") or result.get("usageMetadata") or result.get("usage_metadata")
        elif name == "thread/tokenUsage/updated":
            params = event.get("params")
            tokens = params.get("tokenUsage") if isinstance(params, dict) else None
            usage = tokens.get("last") if isinstance(tokens, dict) else None
        counts = _counts(usage)
        if counts:
            # Snapshot tổng hợp thay thế lần trước, không cộng trùng event usage.
            self.counts.update(counts)
            self.source = name

    def finish(self, status, response=""):
        if self.finished:
            return
        self.finished = True
        record = {**self.record, "status": status, "duration_ms": round((time.monotonic() - self.started) * 1000),
                  "response_utf8_bytes": len(response.encode("utf-8")), "usage_source": self.source,
                  "usage": {field: self.counts.get(field) for field in _FIELDS}}
        try:
            with _LOCK:
                self.folder.mkdir(parents=True, exist_ok=True)
                log = self.folder / (record["scope"] + ".jsonl")
                if log.exists() and log.stat().st_size > 2 * 1024 * 1024:
                    log.replace(log.with_suffix(".previous.jsonl"))
                with log.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                summary_path = self.folder / (record["scope"] + "-summary.json")
                try:
                    summary = json.loads(summary_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    summary = {"requests": 0, "groups": {}}
                key = "/".join((record["kind"], record["provider"], record["model"], record["effort"]))
                group = summary["groups"].setdefault(key, {"requests": 0, "failed": 0, "duration_ms": 0,
                    "prompt_utf8_bytes": 0, "image_count": 0, "reported_requests": 0,
                    "tokens": {field: {"sum": 0, "reported_requests": 0} for field in _FIELDS}})
                summary["requests"] += 1
                group["requests"] += 1
                group["failed"] += status != "completed"
                group["reported_requests"] += bool(self.counts)
                for field in ("duration_ms", "prompt_utf8_bytes", "image_count"):
                    group[field] += record[field]
                for field, value in self.counts.items():
                    group["tokens"][field]["sum"] += value
                    group["tokens"][field]["reported_requests"] += 1
                summary["last_request"] = record
                temporary = summary_path.with_suffix(".tmp")
                temporary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
                temporary.replace(summary_path)
        except (OSError, ValueError, KeyError, TypeError):
            # Telemetry không làm thay đổi kết quả hoặc lỗi của request AI.
            pass


if __name__ == "__main__":
    for scope in ("backtest", "auditor"):
        path = USAGE_FOLDER / (scope + "-summary.json")
        print(path.read_text(encoding="utf-8") if path.exists() else f"{scope}: no measured requests yet")
