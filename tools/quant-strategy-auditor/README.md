# Quant Strategy Auditor

- A React workspace inside [Quant Workspace](../../README.md), available at `/auditor`.
- A local FastAPI engine stores trader observations, screenshots, voice recordings, explanations, and reports.
- Recording is independent of AI. Connected AI observes evidence and records trading-style patterns even without a strategy. Enabled strategy review adds comparison against your documents; uncertain evidence is marked for verification.
- Order submission and simulated backtesting belong to separate future workflows.

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
- `AUDITOR_ENGINE_URL` selects the server-only loopback engine origin. HTTP, recordings and reports go through same-origin Next routes. The deprecated `NEXT_PUBLIC_AUDITOR_ENGINE_URL` is read only as a server fallback.

## Sessions and terminals

- Loading, refreshing, reconnecting, or restarting Python does not create a session or open a terminal.
- The engine restores the active session from `sessions/.active-session.json`, or the most recent valid session on older installations.
- With no saved session, create one explicitly through the session control.
- Creating and switching sessions preserve historical files. Deleting a session requires UI confirmation.
- The header Terminal control opens the current session monitor in the selected host.
- The AI panel opens the selected CLI for login, logout, account switching, or interactive use in Orca, Windows Console, or Windows Terminal.
- Codex uses its native `login` and `logout` commands. Switching accounts signs out first, then starts login.
- AGY opens its interactive CLI with instructions. Use `/logout` to sign out; for switching, use `/logout`, `/exit`, then start `agy` and complete login.
- After any account change, check the AI connection again.
- Orca receives the worktree, PowerShell shell, current Python interpreter, and session monitor command.
- The monitor shows events for its selected session. Missing hosts and failed launches appear as errors.

## Recording

- An active session and a selected capture source are required.
- Choose **Desktop** to select an application window through the local engine, or **Browser** to share a browser tab. Browser sharing rejects application windows and entire screens. Recording captures the full tab content without a region-selection step. Browser address bars and desktop taskbars are excluded; in-page toolbars remain visible.
- Start, Pause, Resume, and Stop control screenshots and event saves.
- Auto-start runs after a Desktop window is selected or a browser tab is registered; the clean example disables it, while the engine's missing-config fallback enables it.
- Session changes and engine restarts stop recording. Select the capture source again after a restart.
- Ending browser sharing pauses recording. If the tab dimensions change, subsequent frames use the new full-tab dimensions without requiring source selection again.
- Browser sharing saves a full-tab screenshot every 15 seconds while recording. Frames accompanying audio use the same selected tab. Desktop mode uses the native window recorder and captures evidence from the selected window, including frames accompanying audio.
- Microphone recording is selected by default and requests browser permission when recording starts. You can turn it off independently. Audio is saved as playable 10-second clips, with **Save audio clip now** to save sooner. Pause, Stop, source changes, and session changes stop the microphone; the final clip stays with its original session.
- The microphone panel shows saved-clip counts, saving status, persistent errors and retry controls. A stale source cannot start a microphone token. Slow uploads stop further recording rather than accumulating an unlimited queue.
- If saving fails, the unsaved clip remains downloadable from the open tab. Download it before closing or reloading that tab. Retrying the microphone starts a new recording; it does not silently resubmit an uncertain save.
- While the microphone records, the selected capture source is sampled every 3 seconds. Each clip includes up to eight saved frames whose timestamps fall inside its audio window. The model receives the audio and matching frames together to correlate visible actions with spoken reasons. These are still frames, not continuous video; actions between frames can be missed, and model responses have provider latency. Frame failures do not discard audio. Source changes stop new frames; the final clip retains only evidence from its original session and source.
- With either CLI connected, new audio clips are offered to the selected model, including without strategy documents. Codex uses native app-server `localAudio` and `localImage` inputs; AGY uses guarded native evidence-file reads. The model must support the audio format. A successful text connection check alone does not verify media support.
- The **Voice recording** panel exposes the microphone switch, current recording duration, saved clip count, immediate-save action, retries, and recovery downloads. Its level meter samples the existing microphone stream locally; it does not open a second microphone or play audio through speakers. Source recording still controls when the microphone records.
- AI and recording status use an adapted [React Bits StarBorder](https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Animations/StarBorder). Decorative motion runs only during connection checks, pending AI observations, or active recording, and respects reduced motion. The audio recorder and input meter use browser media APIs.
- Pending observations use an adapted [React Bits Thought Line](https://reactbits.dev/c/micro/thought-line) with its Hugeicons sparkle SVG, request elapsed time, a restrained shimmer, and settled success/error states. The timer measures the request, including queueing; it does not show internal model reasoning or invented processing steps. Reduced motion keeps the status readable without animation.
- CLI workers own their child process trees and close them before deleting temporary evidence copies. Temporary-folder cleanup cannot replace a provider response or its original error. One observation worker processes a saved queue in request order. New clips continue recording while AI works; waiting does not become a 30-second busy error or fail after eight events. Session logs hold the backlog, and the UI distinguishes waiting from active analysis. Model/account and strategy changes are checked before sending queued evidence. An engine restart interrupts pending work explicitly instead of silently submitting it again.
- AGY streaming requests finish when their terminal `result` event arrives. They do not wait for worker shutdown after a completed turn. Structured schemas are passed as files. Genuine timeouts leave the evidence saved and show a short retry message instead of exposing executable arguments or the full schema, including errors saved by earlier versions.
- AGY's evidence hook runs a copied guard from its own temporary `.agents` folder. Its command contains no project path, so spaces in a checkout path do not break hook arguments. It permits reads of the exact supplied evidence files and the CLI's response-only `finish` tool for structured observations. Other actions remain blocked. A failed evidence read stops the request instead of waiting through repeated tool retries.
- A successful connection check automatically requeues the current session's old busy errors. Genuine media/model failures still require an explicit retry. Recording may outpace model responses; saved evidence remains available while the backlog drains.
- AI transcripts appear beside the original playable clip. Failed media requests leave the recording saved for retry with either provider. Codex audio needs a CLI version exposing app-server `localAudio` input (present in 0.159.3) and an audio-capable model. An unsupported CLI, account, or model produces an event error, with no automatic switch to another provider.
- Terminal dictation remains separate: Codex supports `voice_transcription = true` under `[features]`; AGY offers [F5, `/voice`, or `/record`](https://www.antigravity.google/docs/cli/commands/voice/). Auditor sends its already-recorded clips through native media interfaces, without automating Terminal keypresses or opening another microphone. It does not invoke the dedicated interactive dictation service.

## Strategy reference

- Enable **Use your strategy** only when actual strategy documents are available.
- The default location is `docs/strategy_sheet/Strategy_01.md` and other `Strategy_<number>*.md` documents. Project prompts and directory guides are not strategies.
- Alternatively, set `strategy_documents` in local `config.json` to a list of Markdown paths, relative to that configuration file or absolute paths.
- The engine rescans documents every five seconds and before analysis. Added and edited documents appear without restarting. Empty, missing, or unreadable documents cannot enable reference mode; removing a required document disables review. Adding a document does not automatically enable review.
- With reference mode on, AI compares evidence with the saved document snapshot and asks about differences. It does not automatically label differences as violations.
- With no documents or reference mode off, connected AI still observes actions, transcribes supported audio, describes provisional trading-style patterns, and detects fills supported by clear evidence. No strategy compliance checks run, and strategy documents are not sent.
- Documents supply strategy content, not executable code. The recorder does not generate strategies, validate that a document is a complete trading specification, or approve new rules.

## AI connection and evaluation

- Install AGY CLI or Codex CLI and sign in on each computer. The adapter contains no embedded API key or account credentials.
- Choose one CLI, save the model settings, then explicitly check the connection. Loading the page does not send AI prompts.
- Select a discovered model, or choose the CLI default. AGY model names and effort choices are separated automatically when the CLI publishes multiple effort variants with matching model labels and IDs. Selecting an effort uses the exact native preset ID, without an additional effort override. Effort stays visible and shows a disabled **Không có** (None) when no choices are available. Codex offers the selected model's discovered effort choices. Saved explicit choices are checked against the discovered catalog before saving.
- The selected CLI processes recorded observations and enabled strategy documents through its AI service. Codex uses an ephemeral app-server thread for audio, retaining the selected model and effort; text/image-only requests still use `codex exec`. Audio threads disable configured MCP servers, apps, plugins, hooks, shell tools, and web search, reject client action requests, and close their own process after completion or failure. AGY receives copied screenshot/audio evidence files in an isolated temporary workspace and must report successful reads before its media response is accepted. Status fields `audio_input` and `transcription` indicate adapter support, not verified media comprehension by every model.
- Model dropdowns are discovered from the installed CLI. AGY uses its model list; Codex uses its native model catalog with display names and per-model effort choices. The observer does not select a custom agent. Older saved agent overrides and AGY effort overrides are ignored.
- Use the refresh icon beside **Model** after login, account changes or a CLI update. Missing or unavailable saved choices remain visible for correction. Discovery failures do not create fallback model names or effort lists. Choosing the CLI default omits the corresponding override.
- Use **Open Terminal** to launch the selected CLI in your chosen Terminal host. Manage sign-in, sign-out, and account changes inside the CLI. Terminal launch does not confirm authentication; refresh models and check the connection afterward.
- Catalog discovery reads provider metadata without creating a trading-analysis turn or sending evidence. Catalog results are cached briefly and cleared when the selected account/settings are invalidated; discovery does not mark the AI connection as verified.
- AI should say when it does not know and distinguish observed facts from inferred intent. Uncertainties stay attached to the event for review. Formal teaching and backtest replay belong to the future backtest workflow.
- Recording works while disconnected or without a strategy. Connect later to analyze a saved event. Documents are needed only for optional strategy comparison. Queued work is bounded; busy events retain evidence for retry.
- Recent saved observations and spoken explanations provide bounded memory for subsequent requests in the same session, including after reopening it. Earlier AI interpretations remain uncertain evidence, not independent confirmation or approved rules. This is saved context, not model fine-tuning or a cross-session style profile.
- Changing observation mode or an enabled strategy reference prevents waiting requests from sending stale context. A request already sent to a provider cannot be recalled; its result is excluded from current review when the mode or enabled reference changes. Editing unused strategy files does not interrupt observation mode.
- Changing settings or opening account management invalidates the connection. Recheck before further analysis. Pending observations from previous settings fail with a retry message.
- Codex runs outside the project with read-only sandboxing, user configuration disabled, shell tools disabled, and web search disabled. AGY runs in plan/sandbox mode without slash expansion or permission bypass flags; an observation hook permits only reading the exact supplied media files. The adapter does not expose broker or publishing actions.
- These integrations do not provide continuous video reasoning, guaranteed recognition of orders/fills, or model fine-tuning. Media support depends on the installed CLI and selected model.

## Review and reports

- The observation feed shows the most recent 200 events with evaluation and verification filters. Financial metrics use the complete session ledger.
- Sessions retain their complete event logs, screenshots, microphone clips, historical explanations, and available HTML/PDF reports.
- Results show open LONG/SHORT quantities, closed pairs, gross points, fees, and net points across the complete session ledger.
- AI distinguishes intent, submitted orders, actual fills, cancellations, and unknown observations. Only complete individual VN30F1M executions with an explicit unique execution ID, price, quantity, time, and supporting evidence are automatically counted. Cumulative order totals and unclear fills stay pending.
- Repeated execution IDs cannot add another counted fill. Review detected fills in their event cards to confirm, correct, or exclude them. Corrections retain an audit history and rebuild the ledger in fill-time order.
- BUY closes open SHORT contracts or opens LONG contracts; SELL closes LONG contracts or opens SHORT contracts, using FIFO pairing. Each closed contract pair incurs the configured fee, default 0.45 points. Submitted orders incur no recorded fee.
- This records observed executions without submitting broker orders. It depends on the captured evidence; a separate VNDIRECT order integration remains future work.

## Separate Backtest engine

- Opening `/backtest` starts a separate Python process on `127.0.0.1:8766`. It creates no Auditor recorder, session, observation queue, or source monitor. Opening `/auditor` starts the Auditor process on `127.0.0.1:8765`. Navigating away keeps an already started engine running.
- Manual startup: `python tools/quant-strategy-auditor/run.py --engine backtest --watch`. `BACKTEST_AUTOSTART=0` disables automatic startup. `BACKTEST_PYTHON`, `BACKTEST_UI_URL`, and server-only `BACKTEST_ENGINE_URL` configure its interpreter and loopback connection.
- Both processes read your local `config.json`, but retain independent AI connection state. Backtest prefers `backtest_ai_connection`, falls back to a saved Codex `ai_connection`, then Codex CLI defaults. Check the AI connection inside Backtest. This check sends a short PONG request to the selected CLI, without trading evidence.
- The historical source uses the existing chart symbol search, date calendar, and animated dropdown behavior. Loaded replay and Reset begin at zero visible candles; only Step or Play reveals a minute.

## Backtest adapter contract

- The public Backtest bridge atomically reserves its analyzer's provider lock in its worker before loading and invoking the optional local adapter. Backtest connection checks use the same lock. Auditor owns a separate analyzer in its own process; these locks do not serialize requests across processes. Backtest returns a busy response when admission fails, without adding a provider request to a queue.
- The synchronous adapter entry point is `analyze(analyzer, context, documents, image_path, schema)`. The bridge owns and releases the provider lock. Adapters must not acquire or release it again, call `analyze_event` or connection checks recursively, or start provider work that outlives the call.
- The worker releases its lock on success or failure. If the route is cancelled, it waits for the owned worker before deleting its temporary image. Connection/settings and strategy snapshots are checked before dispatch and before accepting the result.

## Configuration and backups

- Keep your existing `config.json` when reinstalling or moving computers.
- Configuration and session files are local data, separate from a GitHub checkout.
- Stop recording and close the engine before copying complete session folders, including hidden marker files.
- Update interpreter paths, terminal preferences, and capture sources on the new computer.
- Browser-saved layouts and drawings remain in that browser's local storage.
- The old standalone dashboard is retired; the Python root redirects to the Next.js workspace.
