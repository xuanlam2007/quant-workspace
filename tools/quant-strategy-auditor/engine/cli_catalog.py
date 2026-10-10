import json
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
from .cli_process import cli_environment


def list_options(output):
    options = {}
    for line in output.splitlines():
        columns = line.strip().split("\t", 1)
        if len(columns) != 2:
            continue
        identifier = columns[0].strip()
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}", identifier):
            options[identifier] = {"id": identifier, "label": columns[1].strip()}
    return list(options.values())


def separate_agy_presets(models):
    groups = {}
    for model in models:
        match = re.fullmatch(r"(.+?)\s+\(([A-Za-z][A-Za-z0-9 -]*)\)", model["label"])
        if not match:
            continue
        label, effort = match.groups()
        suffix = "-" + re.sub(r"\s+", "-", effort.strip().lower())
        if model["id"].endswith(suffix):
            key = (label, model["id"][:-len(suffix)])
            groups.setdefault(key, []).append((model, effort))
    for (label, _), variants in groups.items():
        # Chỉ tách effort khi CLI công bố nhiều biến thể cùng mã gốc.
        if len(variants) < 2 or len({effort.lower() for _, effort in variants}) != len(variants):
            continue
        group = {"id": variants[0][0]["id"], "label": label}
        for model, effort in variants:
            model["preset_group"] = group
            model["preset_effort"] = effort
    return models


def agy_catalog(executable, folder):
    catalog = {"models": [], "agents": [], "efforts": [], "agents_supported": False, "errors": {}}
    try:
        result = subprocess.run([executable, "models"], cwd=folder, env=cli_environment(), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=12, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode:
            raise RuntimeError(f"AGY catalog command failed ({result.returncode}). Check CLI login and retry.")
        catalog["models"] = separate_agy_presets(list_options(result.stdout))
        if not catalog["models"]:
            raise RuntimeError("AGY returned no available models. Check CLI login and refresh.")
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        catalog["errors"]["models"] = str(error)
    return catalog


def codex_models(executable, folder):
    process = subprocess.Popen([executable, "app-server", "--listen", "stdio://"], cwd=folder, env=cli_environment(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    messages = queue.Queue(maxsize=256)

    def receive():
        try:
            for line in process.stdout:
                try:
                    messages.put(json.loads(line), timeout=1)
                except (ValueError, queue.Full):
                    continue
        except (OSError, ValueError):
            pass
        finally:
            try:
                messages.put(None, timeout=1)
            except queue.Full:
                pass

    reader = threading.Thread(target=receive, daemon=True)
    reader.start()
    deadline = time.monotonic() + 15

    def send(message):
        process.stdin.write(json.dumps(message) + "\n")
        process.stdin.flush()

    def rpc(identifier, method, params=None):
        message = {"id": identifier, "method": method}
        if params is not None:
            message["params"] = params
        send(message)
        while True:
            try:
                message = messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty as error:
                raise RuntimeError("Codex model discovery timed out. Check CLI login and retry.") from error
            if message is None:
                raise RuntimeError("Codex stopped before returning its model catalog.")
            if isinstance(message, dict) and message.get("id") == identifier:
                if message.get("error"):
                    raise RuntimeError(f"Codex rejected {method}. Check CLI login and refresh.")
                return message.get("result", {})

    try:
        # Chỉ đọc danh mục, không tạo phiên AI hoặc gửi dữ liệu giao dịch.
        rpc(1, "initialize", {"clientInfo": {"name": "quant_workspace_catalog", "title": "Quant Workspace", "version": "1.0"}, "capabilities": {"explicitGatewayOauth": True, "experimentalApi": False, "requestAttestation": False}})
        send({"method": "initialized"})
        gateway = rpc(2, "account/gatewayOAuth/read")
        if gateway.get("required") and gateway.get("status") != "succeeded":
            raise RuntimeError("Codex gateway login is required. Sign in through Terminal and refresh.")
        models = []
        cursor = None
        for identifier in range(3, 23):
            page = rpc(identifier, "model/list", {"limit": 100, "cursor": cursor, "includeHidden": False})
            models.extend(page.get("data", []))
            next_cursor = page.get("nextCursor")
            if not next_cursor:
                return models
            if next_cursor == cursor:
                raise RuntimeError("Codex returned a repeated model catalog cursor.")
            cursor = next_cursor
        raise RuntimeError("Codex model catalog exceeded the page limit.")
    finally:
        # Chỉ đóng tiến trình tra cứu riêng, không ảnh hưởng Terminal của người dùng.
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        reader.join(timeout=1)
        process.stdin.close()
        process.stdout.close()


def discover_catalog(provider, executable):
    empty = {"provider": provider, "models": [], "agents": [], "efforts": [], "agents_supported": False, "errors": {}}
    if not executable:
        return {**empty, "errors": {"models": f"{provider} CLI was not found. Install it and sign in through Terminal."}}
    try:
        with tempfile.TemporaryDirectory(prefix="quant-catalog-") as folder:
            if provider == "AGY":
                return {**empty, **agy_catalog(executable, folder)}
            models = []
            for item in codex_models(executable, folder):
                if not isinstance(item, dict) or item.get("hidden") or not isinstance(item.get("model"), str):
                    continue
                efforts = [{"id": value["reasoningEffort"], "label": value["reasoningEffort"], "description": value.get("description", "")} for value in item.get("supportedReasoningEfforts", []) if isinstance(value.get("reasoningEffort"), str)]
                models.append({"id": item["model"], "label": item.get("displayName") or item["model"], "efforts": efforts, "default_effort": item.get("defaultReasoningEffort", ""), "is_default": bool(item.get("isDefault"))})
            return {**empty, "models": models, "errors": {} if models else {"models": "Codex returned no available models. Check CLI login and refresh."}}
    except (OSError, ValueError, TypeError, AttributeError, RuntimeError, subprocess.TimeoutExpired) as error:
        return {**empty, "errors": {"models": str(error)}}
