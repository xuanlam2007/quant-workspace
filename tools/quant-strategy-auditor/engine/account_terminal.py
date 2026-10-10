import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException

from .cli_process import cli_environment


class AccountTerminal:
    def __init__(self, scope, host="ORCA"):
        self.scope = scope
        self.host = host
        self.handles = {}
        self.worktree = str(Path(__file__).resolve().parents[3])

    def open(self, provider, executable):
        if self.host == "NONE":
            raise HTTPException(409, "Select a Terminal host before signing in")
        if self.host not in ("ORCA", "WT", "WINDOWS") or provider not in ("CODEX", "AGY"):
            raise HTTPException(400, "Unsupported Terminal or CLI provider")
        title = f"AI {self.scope.title()} {provider} Account"
        command = "& '" + executable.replace("'", "''") + "'"
        codex_home = (os.environ.get("CODEX_HOME") or str(Path.home() / ".codex")) if provider == "CODEX" else None
        if codex_home:
            # Orca host có thể thuộc account khác; CLI phải dùng CODEX_HOME của engine.
            command = "$env:CODEX_HOME = '" + codex_home.replace("'", "''") + "'; " + command
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            if self.host == "ORCA":
                orca = shutil.which("orca") or os.path.expandvars(r"%LocalAppData%\Programs\orca\resources\bin\orca.exe")

                def invoke(arguments):
                    result = subprocess.run([orca, "terminal", *arguments, "--json"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, creationflags=flags, env=cli_environment())
                    response = json.loads(result.stdout)
                    if result.returncode or not response.get("ok"):
                        raise RuntimeError("Terminal operation was not confirmed")
                    return response.get("result", {})

                terminals = invoke(["list"]).get("terminals", [])
                current = self.handles.get(provider)
                # Chỉ reuse account Terminal đúng provider và worktree, không đụng AI viewer.
                for terminal in terminals:
                    worktree = terminal.get("worktreePath", "")
                    cached = current == (terminal.get("handle"), terminal.get("incarnationId"))
                    if cached and worktree and Path(worktree).resolve() == Path(self.worktree).resolve() and terminal.get("connected") and not terminal.get("orphaned") and terminal.get("handle"):
                        handle = terminal["handle"]
                        invoke(["switch", "--terminal", handle])
                        self.handles[provider] = (handle, terminal.get("incarnationId"))
                        return {"status": "opened", "terminal_type": self.host}
                created = invoke(["create", "--worktree", f"path:{self.worktree}", "--shell", "powershell.exe", "--title", title, "--command", command, "--focus"])
                confirmed = created.get("terminal", {})
                if not confirmed.get("handle"):
                    raise RuntimeError("Terminal creation was not confirmed")
                self.handles[provider] = (confirmed["handle"], confirmed.get("incarnationId"))
            else:
                encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
                launcher = ["wt", "new-tab", "--title", title] if self.host == "WT" else ["conhost.exe"]
                subprocess.Popen([*launcher, "powershell.exe", "-NoExit", "-EncodedCommand", encoded], cwd=self.worktree, env=cli_environment())
            return {"status": "opened", "terminal_type": self.host}
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            raise HTTPException(503, "Cannot open the account Terminal. Check the selected Terminal installation.") from None
