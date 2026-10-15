import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler

from .cli_diagnostics import CliRequestError, agy_final_error
from .cli_process import CliConversation, cli_environment, observer_workspace
from .quant_mcp_route import UUID, write_route

TOOLS = ("get_chart_state", "get_account_state", "get_chart_catalog", "capture_chart", "apply_chart", "submit_order")


def prepare_agy_workspace(folder, environment, files, response_kind, capability=None):
    guard_folder = Path(folder) / ".agents"
    guard_folder.mkdir()
    for filename in ("observer_guard.py", "quant_mcp_artifacts.py", "quant_mcp_route.py"):
        shutil.copyfile(Path(__file__).with_name(filename), guard_folder / filename)
    environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
    command = Path(sys.executable).name + " -I observer_guard.py"
    hooks = {"observer-evidence-only": {"PreToolUse": [{"matcher": ".*", "hooks": [{"type": "command", "command": command, "timeout": 5}]}]}}
    (guard_folder / "hooks.json").write_text(json.dumps(hooks), encoding="utf-8")
    environment["QUANT_OBSERVER_MEDIA_PATHS"] = json.dumps([str(path) for path in files])
    environment["QUANT_OBSERVER_RESPONSE_KIND"] = response_kind
    if capability:
        environment.update({key: capability[key] for key in ("QUANT_MCP_PORT", "QUANT_MCP_CAPABILITY")})
        manifest = guard_folder / "quant-artifacts.json"
        manifest.write_text('{"entries":[]}', encoding="utf-8")
        environment["QUANT_MCP_ARTIFACT_MANIFEST"] = str(manifest)
        environment["QUANT_MCP_ARTIFACT_ROOT"] = str(Path.home() / ".gemini" / "antigravity-cli" / "brain")
        server = {"command": sys.executable, "args": [str(Path(__file__).with_name("quant_mcp_stdio.py").resolve())], "trust": True, "enabledTools": list(TOOLS)}
        plugin = guard_folder / "plugins" / "quant-backtest"
        plugin.mkdir(parents=True)
        (plugin / "plugin.json").write_text(json.dumps({"name": "quant-backtest", "description": "Request-scoped chart and simulated trading tools"}), encoding="utf-8")
        (plugin / "mcp_config.json").write_text(json.dumps({"mcpServers": {"quant": server}}), encoding="utf-8")
        environment["QUANT_OBSERVER_MCP_TOOLS"] = json.dumps(TOOLS)
    return guard_folder


def session_key(settings, context, schema):
    scope = {key: context[key] for key in ("id", "symbol", "granularity", "revision", "hashes", "teaching")}
    return hashlib.sha256(json.dumps([settings, scope, schema], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def definitions(capability):
    port = int(capability["QUANT_MCP_PORT"])
    if not 1 <= port <= 65535:
        raise ValueError("Invalid local Quant endpoint")
    request = Request(f"http://127.0.0.1:{port}/tools", data=b"{}", headers={"Authorization": "Bearer " + capability["QUANT_MCP_CAPABILITY"], "Content-Type": "application/json"}, method="POST")
    with build_opener(ProxyHandler({})).open(request, timeout=3) as response:
        raw = response.read(256001)
    if len(raw) > 256000:
        raise ValueError("Invalid Quant tool registry")
    tools = json.loads(raw)["tools"]
    if not isinstance(tools, list) or len(tools) != len(TOOLS) or {item["name"] for item in tools} != set(TOOLS):
        raise ValueError("Invalid Quant tool registry")
    for tool in tools:
        schema = tool["inputSchema"]
        schema["properties"]["request_id"] = {"type": "string", "pattern": UUID.pattern, "description": "Current observation request_id supplied by the adapter"}
        schema.setdefault("required", []).append("request_id")
    return tools


class AgyReplaySession:
    def __init__(self, executable, settings, capability, schema, terminal=None):
        self.stream = None
        self.closed = False
        self.close_lock = threading.Lock()
        self.idle_timer = None
        self.terminal = terminal
        self.context = capability["_replay"]
        self.key = session_key(settings, self.context, schema)
        self.owner = self.context["owner"]
        self.cutoff = self.context["cutoff"]
        self.turns = self.sent_bytes = 0
        self.last_used = time.monotonic()
        self.workspace = observer_workspace()
        self.folder = self.workspace.__enter__()
        try:
            environment = cli_environment()
            guard = prepare_agy_workspace(self.folder, environment, [], "backtest", capability)
            self.route = guard / "quant-route.json"
            self.tools = definitions(capability)
            self._deactivate()
            environment["QUANT_MCP_ROUTE"] = str(self.route)
            result_schema = json.loads(json.dumps(schema))
            result_schema["properties"]["request_id"] = {"type": "string", "pattern": UUID.pattern}
            result_schema.setdefault("required", []).append("request_id")
            command = [executable, "--add-dir", self.folder, "--mode", "default", "--sandbox", "--disable-slash-commands", "--input-format", "stream-json", "--output-format", "stream-json", "--json-schema", json.dumps(result_schema, ensure_ascii=False, separators=(",", ":"))]
            if settings.get("model"):
                command += ["--model", settings["model"]]
            self.stream = CliConversation(command, cwd=self.folder, env=environment, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except BaseException:
            self.close()
            raise

    def _deactivate(self):
        write_route(self.route, {"version": 1, "active": False, "tools": self.tools})

    def reusable(self, key, cutoff):
        # Giới hạn ngữ cảnh và thời gian nghỉ, không tái dùng qua lượt replay khác.
        return not self.closed and self.stream.process.poll() is None and key == self.key and cutoff >= self.cutoff and time.monotonic() - self.last_used < 300 and self.turns < 256 and self.sent_bytes < 1024 * 1024

    def run(self, prompt, capability, timeout, on_output):
        context = capability["_replay"]
        owner = context["owner"]
        if not isinstance(owner, str) or not UUID.fullmatch(owner):
            raise ValueError("Invalid Quant observation owner")
        self.owner = owner
        manifest = self.route.parent / ("quant-artifacts-" + owner + ".json")
        started = time.monotonic()
        deadline = capability.get("_deadline", started + timeout)
        try:
            with self.close_lock:
                if self.closed:
                    raise CliRequestError("stream_format")
                if self.idle_timer:
                    self.idle_timer.cancel()
                if capability.get("_check"):
                    capability["_check"]()
                manifest.write_text('{"entries":[]}', encoding="utf-8")
                write_route(self.route, {"version": 1, "active": True, "request_id": owner, "port": int(capability["QUANT_MCP_PORT"]), "capability": capability["QUANT_MCP_CAPABILITY"], "manifest": str(manifest), "expires": deadline, "tools": self.tools})
            current_prompt = capability.get("_turn_prompt", prompt) if self.turns else prompt
            current_prompt += '\nTrusted request binding: request_id=' + owner + '. Include this exact request_id inside Arguments for EVERY Quant tool call and as a top-level field in finish. Earlier request IDs are expired. Orders execute only through submit_order; final HOLD only acknowledges completion and never opens or closes a position.'
            self.sent_bytes += len(current_prompt.encode("utf-8"))
            if self.terminal:
                self.terminal.write("runtime.session", state="reused" if self.turns else "created", turn=self.turns + 1, pid=self.stream.process.pid)

            def progress(kind, line):
                if on_output:
                    on_output(kind, line)
                if kind == "stdout" and self.terminal:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        return
                    if event.get("event") == "init":
                        self.terminal.write("runtime.ready", elapsed_ms=round((time.monotonic() - started) * 1000))

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired("AGY replay", timeout)
            result = self.stream.request(current_prompt, remaining, progress)
            events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
            envelope = events[-1].get("result") if events else None
            if not isinstance(envelope, dict) or envelope.get("status") != "SUCCESS":
                raise agy_final_error(envelope)
            value = envelope.get("structured_output")
            if value is None:
                value = json.loads(envelope.get("response", ""))
            if not isinstance(value, dict) or value.pop("request_id", None) != owner:
                raise CliRequestError("stream_format")
            if self.closed:
                raise CliRequestError("stream_format")
            self.turns += 1
            self.cutoff = context["cutoff"]
            self.last_used = time.monotonic()
            return json.dumps(value, ensure_ascii=False)
        except subprocess.TimeoutExpired:
            self.close()
            raise subprocess.TimeoutExpired("AGY replay", timeout) from None
        except BaseException:
            self.close()
            raise
        finally:
            with self.close_lock:
                if not self.closed:
                    self._deactivate()
                    self.idle_timer = threading.Timer(300, self.close)
                    self.idle_timer.daemon = True
                    self.idle_timer.start()
            try:
                manifest.unlink(missing_ok=True)
            except OSError:
                logging.getLogger(__name__).warning("Could not clean the closed AGY request manifest")

    def close(self):
        with self.close_lock:
            if self.closed:
                return
            self.closed = True
            if self.idle_timer:
                self.idle_timer.cancel()
            try:
                if hasattr(self, "route") and hasattr(self, "tools"):
                    self._deactivate()
            except OSError:
                logging.getLogger(__name__).warning("Could not clear the closed AGY request binding")
            finally:
                try:
                    if self.stream:
                        self.stream.close()
                except (OSError, subprocess.TimeoutExpired):
                    logging.getLogger(__name__).warning("Could not finish AGY replay process cleanup")
                finally:
                    self.workspace.__exit__(None, None, None)


def run_replay(analyzer, executable, prompt, settings, capability, schema, timeout, on_output):
    capability.setdefault("_deadline", time.monotonic() + timeout)
    key = session_key(settings, capability["_replay"], schema)
    session = analyzer._agy_replay
    if session is not None and not session.reusable(key, capability["_replay"]["cutoff"]):
        analyzer.close_replay()
        session = None
    if session is None:
        session = AgyReplaySession(executable, settings, capability, schema, analyzer.terminal)
        analyzer._agy_replay = session
    try:
        return session.run(prompt, capability, timeout, on_output)
    except BaseException:
        analyzer.close_replay()
        raise
