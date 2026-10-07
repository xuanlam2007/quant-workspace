# Quant Strategy Auditor

- A React workspace inside [Quant Workspace](../../README.md), available at `/auditor`.
- A local FastAPI engine handles capture, session storage, trade pairing, reports, and optional strategy analysis.
- Simulated order previews do not place broker orders or change recorded positions and realized results.

## Quick start

- Run these commands from the repository root:

```powershell
npm ci
python -m pip install fastapi "uvicorn[standard]" pillow pynput
```

- Use the Python interpreter that will run the engine. `uvicorn[standard]` includes WebSocket support.
- On a fresh installation, create the local configuration only if it is missing:

```powershell
if (-not (Test-Path tools/quant-strategy-auditor/config.json)) {
    Copy-Item tools/quant-strategy-auditor/config.example.json tools/quant-strategy-auditor/config.json
}
npm run dev
```

- Open the development URL printed in the terminal, then select the Auditor tab.
- The clean example disables strategy analysis and auto-start after source selection.
- The engine can start without a configuration file, using its existing defaults.
- Windows is required for native application-window capture. Browser capture requires localhost or HTTPS.

## Engine startup

- Python starts when `/auditor` is first opened, and an existing healthy engine is reused.
- Opening the chart or running `npm run dev` alone does not launch Python.
- The engine stays running when navigating away from the auditor.
- Engine Python edits reload automatically. Screenshots and session files do not trigger reloads.
- Failed source reloads wait for another source edit rather than repeatedly restarting.
- Startup errors appear in the header with a retry action and details in the development terminal.
- Header health checks do not create sessions or start recording.

### Manual startup

```powershell
$env:AUDITOR_OPEN_BROWSER = "0"
python tools/quant-strategy-auditor/run.py --watch
```

- Set `AUDITOR_AUTOSTART=0` before starting Next.js to manage Python manually.
- The engine listens on `127.0.0.1:8765`.
- `AUDITOR_PYTHON` selects the interpreter used by automatic startup.
- `AUDITOR_UI_URL` sets the frontend URL for standalone startup, including a different development port.
- `AUDITOR_OPEN_BROWSER=0` prevents standalone startup from opening a browser window.
- `NEXT_PUBLIC_AUDITOR_ENGINE_URL` selects the frontend's engine URL. Set it before starting Next.js; it is visible in browser code.

## Sessions and terminals

- Loading, refreshing, reconnecting, or restarting Python does not create a session or open a terminal.
- The engine restores the active session from `sessions/.active-session.json`, or the most recent valid session on older installations.
- With no saved session, create one explicitly through the session control.
- Creating and switching sessions preserve historical files. Deleting a session requires UI confirmation.
- The terminal control opens the current session in the selected host.
- Orca receives the worktree, PowerShell shell, current Python interpreter, and session monitor command.
- The monitor shows events for its selected session. Missing hosts and failed launches appear as errors.

## Recording

- An active session and a selected capture source are required.
- Select an application window or explicitly share a browser tab/window. Entire-desktop capture is unsupported.
- Start, Pause, Resume, and Stop control screenshots and event saves.
- Auto-start can be enabled after source selection; the clean example disables it, while the engine's missing-config fallback enables it.
- Session changes and engine restarts stop recording. Select the capture source again after a restart.
- Closing or minimizing the selected desktop window pauses recording.
- Desktop events require the selected window to be in the foreground.

## Simulations and reports

- LONG/SHORT previews evaluate the available strategy backend without saving events.
- Saving a preview with evidence is a separate action and requires active recording.
- Saved previews retain the thesis, warnings, and screenshot without opening positions or increasing actual trade counters.
- Recorded trades are paired for gross points, fees, and net points.
- Sessions retain event logs, screenshots, and available HTML/PDF reports.
- These previews are separate from the planned AI backtesting and teaching workflow described in the [project roadmap](../../README.md#immediate-priority).

## Optional AI analysis

- AGY uses the account signed into its locally installed CLI. Sign in separately on each computer.
- The public adapter contains no embedded API key or account login.
- Checking AGY connectivity is explicit; page loading does not send AI prompts.
- Strategy auditing and analysis require a compatible local backend.
- Without one, the engine reports unavailable analysis. Recording, trade pairing, and session review remain available.
- The extension interface is defined in `engine/strategy_backend.py`: an auditor with `reset()` and `audit(...)`, plus `build_analysis_prompt(context)`.
- Restart the engine after changing a local extension.
- The current local analysis uses event text and strategy context. Screenshots remain evidence; image analysis and audio transcription require further implementation.

## Configuration and backups

- Keep your existing `config.json` when reinstalling or moving computers.
- Configuration and session files are local data, separate from a GitHub checkout.
- Stop recording and close the engine before copying complete session folders, including hidden marker files.
- Update interpreter paths, terminal preferences, and capture sources on the new computer.
- Browser-saved layouts and drawings remain in that browser's local storage.
- The old standalone dashboard is retired; the Python root redirects to the Next.js workspace.
