import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from uuid import uuid4


def cli_failure(provider, code, diagnostic):
    text = str(diagnostic).lower()
    reasons = (
        (("unauthorized", "401", "login", "sign in", "authentication", "token expired"), "CLI authentication failed. Sign in through Terminal and retry."),
        (("model", "reasoning effort"), "The CLI rejected the selected model or effort. Refresh the catalog and check your account access."),
        (("429", "rate limit", "quota", "usage limit"), "The provider usage limit was reached. Wait or check your subscription."),
        (("certificate", "tls", "connection", "network", "dns"), "The CLI could not reach the provider. Check your connection and retry."),
        (("unexpected argument", "unknown option", "unrecognized"), "The installed CLI rejected an option. Update the CLI and retry."),
        (("permission denied", "access is denied", "os error 5"), "The CLI could not access its local files. Check file permissions and retry."),
    )
    reason = next((message for keywords, message in reasons if any(keyword in text for keyword in keywords)), "No recognized diagnostic was returned. Run the selected CLI in Terminal, then retry the connection check.")
    return f"{provider} CLI exited with code {code}. {reason}"


class AiRequestTerminal:
    def __init__(self, scope, host="ORCA", folder=None):
        self.scope = scope
        self.host = host if host in ("ORCA", "WT", "WINDOWS") else "ORCA"
        self.folder = Path(folder) if folder else Path(__file__).resolve().parents[3] / ".agents" / "ai-runs" / scope
        self.lock = threading.RLock()
        self.launching = False
        self.error = ""
        self.request_id = ""
        self.sequence = 0
        self.last_launch = 0

    def write(self, event, **fields):
        with self.lock:
            self.sequence += 1
            record = {"request": self.request_id, "sequence": self.sequence, "event": event, **fields}
            try:
                with (self.folder / "current.jsonl").open("a", encoding="utf-8") as stream:
                    if stream.tell() > 4 * 1024 * 1024 and event not in ("request.completed", "request.failed", "terminal.error"):
                        return
                    stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            except OSError:
                self.error = "Cannot write the current AI request monitor. Analysis can continue."

    def begin(self, settings):
        with self.lock:
            self.folder.mkdir(parents=True, exist_ok=True)
            self.request_id = uuid4().hex
            self.sequence = 0
            self.error = ""
            (self.folder / "current.jsonl").write_text("", encoding="utf-8")
            self.write("request.started", scope=self.scope, provider=settings["provider"], model=settings.get("model") or "CLI default", effort=settings.get("effort") or "CLI default")
            heartbeat = self.folder / "viewer.heartbeat"
            alive = heartbeat.is_file() and time.time() - heartbeat.stat().st_mtime < 5
            if not alive and not self.launching and time.monotonic() - self.last_launch > 35:
                self.launching = True
                self.last_launch = time.monotonic()
                threading.Thread(target=self._launch, daemon=True).start()

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
        if name not in ("thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.completed", "step_update", "result", "thread/started", "turn/started", "turn/completed", "item/started", "item/completed", "item/reasoning/summaryTextDelta"):
            return
        params = event.get("params") or {}
        if not isinstance(params, dict):
            return
        nested_thread = params.get("thread") or {}
        if not isinstance(nested_thread, dict):
            nested_thread = {}
        thread = event.get("thread_id") or event.get("conversation_id") or event.get("session_id") or params.get("threadId") or nested_thread.get("id")
        fields = {}
        if isinstance(thread, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", thread):
            fields["session"] = thread
        item = event.get("item") or params.get("item") or event.get("step_update") or {}
        if not isinstance(item, dict):
            item = {}
        category = item.get("type") or item.get("state")
        if isinstance(category, str) and re.fullmatch(r"[a-zA-Z0-9_/-]{1,80}", category):
            fields["stage"] = category
        # Chỉ ghi metadata đã chọn; không ghi prompt, credentials hoặc tool arguments.
        self.write(name, **fields)

    def _launch(self):
        script = Path(__file__).resolve()
        python = Path(sys.executable)
        if python.stem.lower() in ("pythonw", "pyw"):
            candidate = python.with_name("python.exe" if python.stem.lower() == "pythonw" else "py.exe")
            if candidate.is_file():
                python = candidate
        arguments = [str(python), str(script), "--watch", str(self.folder)]
        command = "& " + " ".join("'" + value.replace("'", "''") + "'" for value in arguments)
        encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
        title = f"AI {self.scope.title()} Session"
        try:
            if self.host == "ORCA":
                executable = shutil.which("orca") or os.path.expandvars(r"%LocalAppData%\Programs\orca\resources\bin\orca.exe")
                result = subprocess.run([executable, "terminal", "create", "--worktree", f"path:{script.parents[3]}", "--shell", "powershell.exe", "--title", title, "--command", command, "--focus", "--json"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                response = json.loads(result.stdout)
                if result.returncode or not response.get("ok") or not response.get("result", {}).get("terminal", {}).get("handle"):
                    raise RuntimeError("Terminal creation was not confirmed")
            else:
                command = ["powershell.exe", "-NoExit", "-EncodedCommand", encoded]
                launcher = ["wt", "new-tab", "--title", title] if self.host == "WT" else ["conhost.exe"]
                subprocess.Popen([*launcher, *command], cwd=str(script.parents[3]))
            self.error = ""
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            self.error = "Cannot open the AI session Terminal. Check the selected Terminal installation. Analysis can continue."
            self.write("terminal.error", message=self.error)
        finally:
            self.launching = False


def watch(folder):
    folder = Path(folder)
    request, offset = "", 0
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("Live AI request monitor. Read-only, no additional AI request. Ctrl+C closes this viewer.", flush=True)
    try:
        while True:
            (folder / "viewer.heartbeat").touch()
            try:
                with (folder / "current.jsonl").open(encoding="utf-8") as source:
                    first = source.readline(128000)
                    try:
                        identifier = json.loads(first)["request"]
                    except (ValueError, KeyError):
                        identifier = request
                    if identifier != request:
                        request, offset = identifier, 0
                        print(f"\nRequest {request}", flush=True)
                    source.seek(offset)
                    while True:
                        line = source.readline(128000)
                        if not line.endswith("\n"):
                            break
                        offset = source.tell()
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue
                        print(json.dumps({key: value for key, value in event.items() if key not in ("request", "sequence")}, ensure_ascii=False), flush=True)
            except OSError:
                pass
            time.sleep(.25)
    except KeyboardInterrupt:
        pass
    finally:
        (folder / "viewer.heartbeat").unlink(missing_ok=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", required=True)
    watch(parser.parse_args().watch)
