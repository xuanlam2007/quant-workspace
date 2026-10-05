# Quant Strategy Auditor

The UI is a React workspace in the existing Next.js app at `/auditor`. FastAPI retains desktop capture, strategy auditing, storage, trade pairing, reports, and AGY CLI analysis.

From the repository root, start both services with:

```powershell
npm run dev
```

The development launcher starts Python in the background, without opening another window. Engine Python changes reload the backend automatically. Stopping the launcher stops the engine it started. An existing process on port 8765 is left untouched; stop an older manually started engine once to let the launcher take over. Set `AUDITOR_PYTHON` to a Python executable if needed, or `AUDITOR_AUTOSTART=0` to opt out. Missing dependencies and startup failures appear in the development terminal.

For standalone use, run `python tools/quant-strategy-auditor/run.py --watch`. The watcher only monitors Python source, not saved screenshots or session files. Failed code reloads wait for the next source edit rather than repeatedly restarting.

Open `http://localhost:3000/auditor`. If Next uses another port, set `AUDITOR_UI_URL` before starting Python. To run the engine without opening a browser window, set `AUDITOR_OPEN_BROWSER=0`.

The engine listens on `127.0.0.1:8765`. The frontend can use another engine URL through `NEXT_PUBLIC_AUDITOR_ENGINE_URL`, set before starting Next. This is a local desktop tool; browser capture requires localhost or HTTPS. Python retains its existing FastAPI, Uvicorn, WebSocket, and optional screenshot/global-hotkey dependencies.

Loading the page, reconnecting, or restarting Python does not create a session or open a terminal. The engine restores the active-session marker under `sessions/.active-session.json`. Existing installations without this marker restore their most recent valid session. With no saved session, explicitly create one through **New session**. Session creation and switching preserve historical files. Deletion requires confirmation in the UI.

The terminal button opens the current session in the selected host. Orca receives an explicit worktree, PowerShell shell, current Python interpreter, and monitor command. Missing hosts and failed launches appear as errors. The session monitor only displays events belonging to its selected session.

AGY uses the account already signed into its CLI. The API-key setting and direct SDK path are removed. Checking AGY connectivity is explicit; page loading does not send AI prompts. The retained CLI analysis uses event text and guardrail warnings. Screenshots are saved and viewable as evidence, but the CLI prompt does not upload those images or transcribe audio.

Recording starts stopped. Select an application window or explicitly share a browser tab/window before starting. Entire-desktop capture is not supported. Start, Pause, and Resume govern screenshots and event saves. Auto-start after source selection is enabled by default and can be disabled in the capture panel. An active session is required before recording can begin. Session changes and engine restarts stop recording; a restart requires selecting the source again. Closing or minimizing the selected desktop window pauses recording. Desktop events require that window to be in the foreground.

**Decision testing** previews LONG or SHORT against current guardrails without saving anything. **Save test with evidence** is separate and requires active recording. Tests retain the thesis, warnings, and screenshot but do not open positions, alter realized P&L, or increase actual trade counters.

The previous standalone HTML/JavaScript dashboard is retired. The Python root redirects to the Next workspace. Existing sessions remain compatible.
