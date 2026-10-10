import json
import sys
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.account_terminal import AccountTerminal


def response(result):
    return CompletedProcess([], 0, json.dumps({"ok": True, "result": result}), "")


class AccountTerminalTests(unittest.TestCase):
    def test_reuses_only_matching_live_account_terminal(self):
        terminal = AccountTerminal("backtest")
        terminal.handles["CODEX"] = ("current", "current-instance")
        entries = [
            {"title": "AI Backtest Session", "handle": "viewer", "worktreePath": terminal.worktree, "connected": True},
            {"title": "AI Backtest CODEX Account", "handle": "old", "worktreePath": terminal.worktree, "connected": True, "orphaned": True},
            {"title": "AI Backtest CODEX Account", "handle": "current", "incarnationId": "current-instance", "worktreePath": terminal.worktree, "connected": True},
        ]
        with patch("engine.account_terminal.subprocess.run", side_effect=[response({"terminals": entries}), response({})]) as run:
            terminal.open("CODEX", "codex.exe")
        self.assertIn("switch", run.call_args.args[0])
        self.assertIn("current", run.call_args.args[0])
        self.assertEqual(run.call_count, 2)

    def test_creates_provider_terminal_with_literal_command(self):
        with patch("engine.account_terminal.subprocess.run", side_effect=[response({"terminals": []}), response({"terminal": {"handle": "new"}})]) as run:
            AccountTerminal("backtest").open("AGY", "C:/O'Brien/agy.exe")
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[arguments.index("--command") + 1], "& 'C:/O''Brien/agy.exe'")
        self.assertIn("AI Backtest AGY Account", arguments)
        self.assertIn("--focus", arguments)

    def test_failure_does_not_expose_subprocess_output(self):
        with patch("engine.account_terminal.subprocess.run", return_value=CompletedProcess([], 1, "private diagnostic", "secret")):
            with self.assertRaises(HTTPException) as error:
                AccountTerminal("backtest").open("CODEX", "codex.exe")
        self.assertEqual(error.exception.status_code, 503)
        self.assertNotIn("private", error.exception.detail)
        self.assertNotIn("secret", error.exception.detail)

    def test_cached_incarnation_survives_title_change(self):
        terminal = AccountTerminal("backtest")
        terminal.handles["CODEX"] = ("current", "same-instance")
        entries = [{"title": "Renamed by CLI", "handle": "current", "incarnationId": "same-instance", "worktreePath": terminal.worktree, "connected": True}]
        with patch("engine.account_terminal.subprocess.run", side_effect=[response({"terminals": entries}), response({})]) as run:
            terminal.open("CODEX", "codex.exe")
        self.assertIn("switch", run.call_args.args[0])

    def test_codex_terminal_uses_engine_account_home(self):
        with patch.dict("os.environ", {"CODEX_HOME": "C:/engine/account's home"}), patch("engine.account_terminal.subprocess.run", side_effect=[response({"terminals": []}), response({"terminal": {"handle": "new"}})]) as run:
            AccountTerminal("backtest").open("CODEX", "codex.exe")
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[arguments.index("--command") + 1], "$env:CODEX_HOME = 'C:/engine/account''s home'; & 'codex.exe'")

    def test_disabled_host_does_not_launch(self):
        with patch("engine.account_terminal.subprocess.run") as run:
            with self.assertRaises(HTTPException) as error:
                AccountTerminal("backtest", "NONE").open("CODEX", "codex.exe")
        self.assertEqual(error.exception.status_code, 409)
        run.assert_not_called()
