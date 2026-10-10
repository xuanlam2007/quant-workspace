# Quant Workspace

An AI autonomous trading platform in development, bringing market charts, strategy auditing, and trading research into one workspace. Built around understanding how a real trading chart works.

I'm a second-year college student, and this project started as a way to learn how VNDIRECT's chart works. Following that curiosity led me into reverse-engineering its behavior and building a chart and strategy-auditing workspace of my own.

I inspected its JavaScript bundles, followed historical-data requests and real-time messages, and traced the algorithms behind candle construction, indicator calculations, and symbol comparison. I worked through the chart's state changes and interactions, then used those findings to reproduce its observable behavior in my own Next.js app.

Much of the work has been learning as I go: reading unfamiliar code, checking my assumptions, and revisiting implementations when they behaved differently from the reference. I'm documenting what I find as the workspace grows.

## Reverse-engineering VNDIRECT

The reverse-engineering is a core part of this project. I investigate how VNDIRECT produces the result on screen: which data it uses, which algorithms transform it, and which state changes control the interaction. My workflow is to trace the relevant bundle code, understand the calculation or transition, compare it with the observed result, and adapt it to the libraries used here. CodeGraph and AI coding assistants help me navigate the code and work through implementation details.

Some of the things I've investigated and brought into this project:

- **Market-data flow.** How historical requests and live Socket.IO messages fit together, including the Engine.IO v3 connection used by the existing feed.
- **Candle construction.** How ticks become OHLCV bars, how timestamps and trading sessions affect the chart, and how new bars continue from historical data. The implementation lives in [bar-builder.ts](lib/bar-builder.ts).
- **Symbol comparison.** How the reference `Compare` study adopts another symbol's values onto the main symbol's timeline. I adapted that behavior in [chart-utils.ts](components/chart/core/chart-utils.ts).
- **Indicator calculations.** The reference study runtime, its inputs, defaults, and output metadata, adapted through [reference-studies.ts](lib/reference-studies.ts) and rendered with the project's chart library.
- **Chart interactions.** Drawing tools, axis behavior, menus, saved layouts, settings, hover states, colors, and SVG assets. Small details matter when I'm comparing the result with the reference.

One example that took careful investigation was the apparent gap from 14:30 to 14:44 when comparing symbols. The reference `Compare` study uses the main symbol's timestamps and adopts the latest comparison value at or before each timestamp. A comparison symbol can have valid data in that interval without adding those times to the main chart. Understanding that distinction helped me reproduce the 14:29 to 14:45 transition without throwing away valid comparison data.

This work covers the chart and market-data behavior visible in the supplied bundles. It doesn't reveal VNDIRECT's private broker-side trading algorithms. Using a different chart library also means some features need adaptation; I document those limits instead of claiming everything is an exact copy.

## Inside the workspace

- **Chart:** historical and real-time prices, multiple intervals, comparisons, volume, indicators, drawing tools, and saved layouts.
- **Visual backtest:** a separate M1 replay workspace using the full chart component, including indicators, comparisons, drawing tools, menus, and settings, with pause/resume, AI decision review, and simulated Market, Limit, and Stop-Limit orders. Imported second-level data can build an unfinished M1 candle; M1 files reveal a candle only after it closes.
- **Analyzer Auditor:** sessions, a selected Desktop window or the full content of a browser tab, optional microphone recording, timestamped evidence, trader explanations, and session review. Desktop captures the selected application window through the local engine. Browser sharing accepts tabs only, excluding browser address bars and desktop taskbars; toolbars inside the selected webpage remain visible. Chart downloads and Backtest AI snapshots capture the chart canvas directly, excluding toolbars.
- **Strategy review:** optional AI evaluation against your saved strategy documents, evidence limitations, and HTML reports with PDF export when available.
- **Recorded results:** detected fills, open LONG/SHORT quantities, closed pairs, gross points, fees, and net points. Clear individual VN30F1M executions with a unique execution ID can be counted automatically. Unclear evidence stays pending, and recorded fills can be corrected or excluded.
- **AI connection:** choose AGY CLI or Codex CLI, model and effort, with account management through the selected Terminal host. Both adapters accept screenshots and recorded audio, subject to CLI and model support.
- **CLI choices:** model names, available AGY agents and effort options are discovered from the installed CLI. Codex efforts follow the selected model. Refresh the dropdowns after account changes or use the CLI default; catalog discovery does not replace the connection check.

- The Auditor records trading activity and reviews evidence against your strategy. It does not submit orders, teach new rules, or automatically classify unexplained actions as violations.
- Without strategy documents, or with strategy review disabled, connected AI still observes evidence, records explanations, and describes patterns in the trader's style. It does not check strategy compliance or treat observed patterns as approved rules. Add your own Markdown documents and enable review to compare evidence against them. Documents are detected and refreshed without code changes or an engine restart.
- Microphone recording is selected by default, asks for browser permission, and can be turned off. Clips are saved locally every 10 seconds or on demand for playback, with microphone status and retry controls. The selected capture source is sampled every 3 seconds and matching timestamped frames accompany each clip. With the selected CLI connected, the model can correlate visible trading actions with spoken explanations, including when strategy review is off. These are sampled frames with short audio clips, not continuous video or guaranteed instant responses. Failed requests remain saved for retry.
- Recorded clips use Codex app-server audio attachments or AGY's native evidence-file reader, using the selected model and existing CLI login. These automated requests do not press Terminal dictation shortcuts or open another microphone. Codex's `voice_transcription` setting and AGY's [F5 or `/voice`](https://www.antigravity.google/docs/cli/commands/voice/) remain available for interactive Terminal input.
- Evidence analysis requires an explicit connection check. The selected CLI sends observation text and available screenshots to its AI service; AGY additionally receives microphone evidence. Strategy documents are included only with review enabled. Saved observations and spoken explanations provide bounded context for later requests in the same session, including after reopening it. This does not change strategy rules or fine-tune a model.

## Where I want to take it

I want AI to understand, apply, backtest, and evaluate my trading strategies, then explain its decisions through evidence and annotated charts. The strategies and trading rules come from me. AI must not invent strategies or change those rules without my approval. When a rule is unclear, it should ask rather than guess.

### My trading scope

The public chart and auditor provide tools for chart exploration, session review, and trading research. My personal AI trading direction has a specific scope:

- One VNDIRECT account, my own.
- VN30F1M futures, one contract expiry at a time.
- Day trading, with no overnight positions.
- Technical analysis using price and volume.
- M1 only for AI trading analysis and decisions.

The chart supports other symbols and intervals for exploration. That support does not expand my personal trading scope or authorize AI to trade other products or use other analysis timeframes.

### Immediate priority

The immediate workflow is to learn from trader evidence and explanations, then test strategy understanding in the separate Backtest tab. Its initial implementation provides replay and simulated execution; a future derivatives-order tab will handle approved live execution:

- [ ] Understand my documented strategies through examples and teaching, preserving their conditions and recording rule changes only after my approval.
- [ ] Produce evidence-based decisions with the strategy, action, time, reference price, relevant stop-loss conditions, and reasons to trade, wait, or skip.
- [ ] Use my existing drawing tools to annotate setups, trade markers, explanations, calculations, and results on the chart, with annotated chart images for review.
- [ ] Replay historical data with simulated orders and pause/resume controls, letting me inspect decisions and teach AI before continuing. AI should only see data available at the replay time and may execute simulated orders under the approved rules without approval for each order.
- [ ] Evaluate strategy understanding and results on data separate from the teaching examples, recording mistakes, evidence, and assumptions about fills, fees, and slippage.

My trading research is intended to use **second-level historical data, not historical tick data**. The chart history adapter currently supplies M1; second-level files must be sourced separately and checked for actual sampling granularity. Backtesting must respect that limit rather than assume the price path within each second. Receiving live ticks and replaying historical ticks are separate capabilities: the existing live feed does not supply historical tick replay. Historical tick replay would require its own data source and implementation. Data granularity does not change the M1-only analysis scope.

Teaching means working through guidance, examples, and approved strategy documents. A correction to one simulated trade does not automatically become a new trading rule or fine-tune a model.

### Try backtesting

- Open **Backtest** and load a historical day, import a JSON file, or choose the explicitly labeled synthetic demonstration.
- Loading or resetting starts at `0 / N` with no visible candles. Step or Play reveals the first minute. Use the chart's symbol search and calendar to choose the historical source.
- Auditor and Backtest run as separate Python processes. Opening Backtest starts only its engine on `127.0.0.1:8766`; opening Auditor starts its engine on `127.0.0.1:8765`. Each header badge reports its own engine health, separately from AI readiness.
- Check the CLI connection inside Backtest before asking AI to analyze. The Backtest process reads `backtest_ai_connection` from your local auditor configuration, falling back to an existing Codex configuration or Codex CLI defaults. It does not require an Auditor session or recording.
- To launch Backtest manually, run `python tools/quant-strategy-auditor/run.py --engine backtest --watch`. Optional settings are `BACKTEST_AUTOSTART=0`, `BACKTEST_PYTHON`, `BACKTEST_UI_URL`, and server-only `BACKTEST_ENGINE_URL`.
- JSON imports use `symbol`, `granularity` (`1s` or `1m`), and chronological `bars` containing `time` (Unix seconds at the start of the sample), `open`, `high`, `low`, `close`, and per-sample `volume`. Each run uses one symbol and one day.
- The chart history connection loads M1. Second-level replay requires a separate file with genuine second-level samples; Unix timestamps measured in seconds do not establish the sampling interval. The supplied VNDIRECT reference advertises minute and longer history intervals, not `1S`.
- Draw lines, step forward by minute, or run the replay. An optional local AI adapter connects the selected Codex model to your strategy documents, visible chart image, drawing coordinates, and replay state. Replay works without that adapter. No strategy means no AI trading decisions.
- AI requests can be manual or spaced every 1, 3, or 5 replay minutes. Replay waits for a response in learning mode and records actual response duration separately. This does not validate live execution deadlines.
- Backtest fixes the primary chart to the imported symbol and M1. Change the primary symbol through its data source controls. Comparison history is bounded by the replay cutoff and includes only completed M1 bars; replay never subscribes its chart or comparisons to live ticks.
- Stop-Limit activation does not prove a fill. The initial simulator uses sample closing prices and considers a triggered limit for execution only on a later sample. It does not infer an intrabar path from OHLC, liquidity, partial fills, slippage, or broker behavior.
- The initial simulator supports one position and one contract. It records fees on closed pairs and leaves unresolved orders and positions visible at the end. Automatic end-of-session exits are not implemented.
- Pause to correct AI understanding, then restart for a separate run. Previous results stay separate in the open tab and are excluded from the next AI context. Export results before closing or refreshing the page.

### Future execution

- [ ] Authenticated VNDIRECT Open API integration for account, order, and position operations.
- [ ] Live autonomous execution within the rules, risk limits, and permissions I approve.

These remain future work. The existing market-data connection is separate from authenticated broker order integration, and backtest results do not authorize a switch to live trading. I decide when to move to each execution stage.

Production AI models, providers, and architecture are not finalized. Earlier experiments and the selectable AGY/Codex CLI integrations do not settle those choices.

## Run locally

The chart requires Node.js 20.9 or newer and npm. The optional auditor also requires Python and a browser that supports browser-tab sharing.

```powershell
git clone https://github.com/xuanlam2007/quant-workspace.git
cd quant-workspace
npm ci
npm run dev
```

Open the URL printed in the terminal, usually `http://localhost:3000`. If that port is occupied, the development launcher selects another port.

The public checkout runs with **Sample data** by default. The chart generates synthetic history and a new tick every second, so you can try intervals, indicators, comparisons, and drawings without a market-data account. These prices are demonstration data, even when the selected symbol has a real market name. Opening the Auditor first does not start the chart feed.

`.env.example` is a template and is not loaded automatically. `.env.local` supplies your local settings; keeping both files does not combine their data.

| Configured endpoint URLs | Chart mode |
| --- | --- |
| Both missing or using `example.com` placeholders | Synthetic sample history and ticks. |
| Both pointing to real, compatible endpoints | Live provider history and ticks. |
| Only one real endpoint, or an invalid URL | Configuration error. |

After changing provider settings, restart the development server and refresh the browser to initialize the new feed. A live provider failure reports an error instead of switching to sample prices.

### Connect your own market-data provider

See [SECURITY.md](SECURITY.md) for environment exposure, strict request contracts and dependency locking. Engine credentials and optional market API tokens stay server-side. This workspace binds to loopback by default.

This step is optional. Keep the default sample mode to explore the workspace.

```powershell
Copy-Item .env.example .env.local
```

Skip the copy if you already have `.env.local`. Edit that local file with your provider settings:

```dotenv
MARKET_DATA_API_URL=https://api.example.com
MARKET_DATA_SOCKET_URL=https://socket.example.com/
MARKET_DATA_PROVIDER_NAME=Market data
```

The example addresses are placeholders and keep sample mode enabled. Replace **both** URLs with compatible endpoints to enable live mode, then restart the development server. The API base must provide `/history` and `/symbols` with the UDF-style responses handled by this project. The socket URL must expose the Socket.IO 2.x namespace with `price` events and `addsymbol`/`removesymbol` subscriptions. An arbitrary REST API or WebSocket server needs an adapter; changing its URL alone is not enough.

The handler code stays public, but actual provider addresses belong in ignored local configuration. The browser receives the socket address at runtime, so it remains visible in its network tools. Incomplete configuration reports an error, and a failed live provider does not silently turn into sample prices.

### Enable the auditor

Install its Python dependencies using the interpreter that will run the engine:

```powershell
python -m pip install fastapi "uvicorn[standard]" pillow pynput
```

The [Uvicorn standard extras](https://uvicorn.dev/installation/) include the WebSocket dependency used by the auditor. For a fresh clone, create your local configuration from the clean example:

```powershell
Copy-Item tools/quant-strategy-auditor/config.example.json tools/quant-strategy-auditor/config.json
```

Keep an existing `config.json` if you already have one. It contains local settings and should stay outside version control. The example contains no personal strategy and disables auto-start after source selection.

Open the Auditor tab or `/auditor`. The development app starts the Python engine on first use and reuses an existing healthy engine. Opening the chart alone does not start Python. Create a session, select a capture source, and start recording explicitly. Loading or refreshing the workspace does not create a session or open a terminal.

AI is optional. Choose an installed AGY CLI or Codex CLI in the connection panel, open Terminal to manage its account, save the model settings, and check the connection explicitly. AGY model and effort choices are separated automatically from its available presets; Effort stays visible and is disabled when no choices are available. Codex offers model-specific effort settings. Refresh the model list with the icon beside the dropdown after changing accounts. Recording and session review work without AI. To enable strategy reference, configure Markdown strategy documents as described in the [auditor guide](tools/quant-strategy-auditor/README.md#strategy-reference).

For manual engine startup:

```powershell
$env:AUDITOR_OPEN_BROWSER = "0"
python tools/quant-strategy-auditor/run.py --watch
```

The engine listens on `127.0.0.1:8765`. Set `AUDITOR_AUTOSTART=0` before starting Next.js to manage it manually. Other optional settings are:

| Variable | Purpose |
| --- | --- |
| `AUDITOR_PYTHON` | Choose the Python interpreter used by the development app. |
| `AUDITOR_UI_URL` | Set the frontend URL when launching the standalone engine, including a different Next.js port. |
| `AUDITOR_OPEN_BROWSER` | Set to `0` to prevent standalone startup from opening a browser window. |
| `NEXT_PUBLIC_AUDITOR_ENGINE_URL` | Choose the engine URL used by the frontend. This value is visible in browser code. |

See the [auditor guide](tools/quant-strategy-auditor/README.md) for recording, session restoration, terminal integration, and AI behavior.

### Local settings and backups

On another computer, install the dependencies above, restore your local environment settings and auditor configuration, and update machine-specific paths and capture sources. Sign in to the selected optional AGY or Codex CLI separately.

Stop recording and close the auditor engine before transferring complete session folders. Browser-saved layouts and drawings remain in that browser's local storage.

## Repository layout

```text
app/                            Next.js routes and workspace styles
components/Chart.tsx            Chart workspace
components/chart/               Chart controls, drawings, studies, and layouts
components/auditor/             Strategy auditor UI
lib/                            Market-data, chart, and auditor integration
tools/quant-strategy-auditor/    Python audit engine and its guide
scripts/                        Development launchers
vendor/                         Local compatibility dependencies
```

The frontend uses Next.js, React, TypeScript, and Lightweight Charts. The local auditor uses FastAPI and Uvicorn. Market-data history is requested through the app's routes; live ticks are aggregated into OHLCV bars on the client. Keep the Socket.IO 2.x client compatible with the existing Engine.IO v3 transport when changing dependencies.

## Branches and development

| Branch | Role |
| --- | --- |
| [`main`](https://github.com/xuanlam2007/quant-workspace/tree/main) | The complete chart-and-auditor platform and the base for future development. |
| [`legacy/chart-only`](https://github.com/xuanlam2007/quant-workspace/tree/legacy/chart-only) | Preserved chart-only predecessor, with its development history sanitized for public sharing. |
| [`analyzer-auditor`](https://github.com/xuanlam2007/quant-workspace/tree/analyzer-auditor) | Retained development history of the Analyzer Auditor integration. |
| [`feature/backtest-engine`](https://github.com/xuanlam2007/quant-workspace/tree/feature/backtest-engine) | Backtest engine development using the full chart, replay controls, and simulated orders. |

Start new work from `main` on short-lived `feat/...`, `fix/...`, or `docs/...` branches, then open a pull request back to `main`. Preserve the legacy branch as the historical chart version.

Whenever a branch is created, add it to this table immediately with its purpose. Link published branches to GitHub; mark unpublished branches as local and add their links when published. Update this table when branches are renamed or retired.

When proposing changes, describe the resulting behavior and relevant validation. Chart behavior should be checked against the supplied VNDIRECT reference, and changes to auditor storage should preserve existing sessions. Keep real session evidence and personal configuration out of examples and tests.

## Origins

This project started as **`vndirect-chart-next`**, my Next.js chart focused on reproducing VNDIRECT's observable behavior. Its original repository address was [xuanlam2007/vndirect-chart-next](https://github.com/xuanlam2007/vndirect-chart-next).

I originally called the bigger idea **VNDIRECT AI Autonomous Trading Platform**. I'm keeping both old names here because they're part of how this project started. **Quant Workspace** is the name I'm taking forward as the work grows into charts, auditing, strategy research, and AI-assisted trading.

The [chart-only branch](https://github.com/xuanlam2007/quant-workspace/tree/legacy/chart-only) preserves the predecessor rather than replacing its history.

## License

The existing [GNU GPL v3 license](LICENSE) is retained. This project is independently developed and is not an official VNDIRECT product.
