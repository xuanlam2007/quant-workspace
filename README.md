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
- **Strategy auditor:** trading sessions, selected application-window or browser capture, recording controls, event evidence, session review, and strategy warnings with a configured backend.
- **Results:** closed trade pairs, gross and net points, configurable fees, and HTML reports with PDF export when available.
- **AI assistance:** optional AGY CLI connection using an existing CLI login, with strategy analysis supplied by a locally configured backend.

The auditor's LONG/SHORT previews are simulations. They don't send orders to a broker or change recorded positions and realized results. AI analysis currently uses text; screenshots are saved as evidence. Visual analysis and automatic audio transcription still need their own implementation.

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

The next step is to specify and build the strategy-understanding and simulated-backtesting workflow. It extends beyond the auditor's existing LONG/SHORT previews:

- [ ] Understand my documented strategies through examples and teaching, preserving their conditions and recording rule changes only after my approval.
- [ ] Produce evidence-based decisions with the strategy, action, time, reference price, relevant stop-loss conditions, and reasons to trade, wait, or skip.
- [ ] Use my existing drawing tools to annotate setups, trade markers, explanations, calculations, and results on the chart, with annotated chart images for review.
- [ ] Replay historical data with simulated orders and pause/resume controls, letting me inspect decisions and teach AI before continuing. AI should only see data available at the replay time and may execute simulated orders under the approved rules without approval for each order.
- [ ] Evaluate strategy understanding and results on data separate from the teaching examples, recording mistakes, evidence, and assumptions about fills, fees, and slippage.

The historical data available for my trading research has **second-level granularity, not historical tick data**. Planned backtesting must respect that limit rather than assume the price path within each second. Receiving live ticks and replaying historical ticks are separate capabilities: the existing live feed does not supply historical tick replay. Historical tick replay would require its own data source and implementation. Data granularity does not change the M1-only analysis scope.

Teaching means working through guidance, examples, and approved strategy documents. A correction to one simulated trade does not automatically become a new trading rule or fine-tune a model.

### Future execution

- [ ] Authenticated VNDIRECT Open API integration for account, order, and position operations.
- [ ] Live autonomous execution within the rules, risk limits, and permissions I approve.

These remain future work. The existing market-data connection is separate from authenticated broker order integration, and backtest results do not authorize a switch to live trading. I decide when to move to each execution stage.

Production AI models, providers, and architecture are not finalized. Earlier experiments and the optional AGY CLI integration do not settle those choices.

## Run locally

The chart requires Node.js 20.9 or newer and npm. The optional auditor also requires Python; Windows is required for its native application-window capture.

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

Keep an existing `config.json` if you already have one. It contains your personal settings and strategy notes and should stay outside version control. The example contains no personal strategy and disables auto-start after source selection.

Open the Auditor tab or `/auditor`. The development app starts the Python engine on first use and reuses an existing healthy engine. Opening the chart alone does not start Python. Create a session, select a capture source, and start recording explicitly. Loading or refreshing the workspace does not create a session or open a terminal.

AGY CLI is optional. Sign in through that CLI separately; no API key is configured in this app. Strategy analysis requires a compatible local backend. Without one, recording and session review still work, and analysis reports that it is unavailable.

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

On another computer, install the dependencies above, restore your local environment settings and auditor configuration, and update machine-specific paths and capture sources. Sign in to optional AGY CLI separately.

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
| `main` | The complete chart-and-auditor platform and the base for future development. |
| [`legacy/chart-only`](https://github.com/xuanlam2007/quant-workspace/tree/legacy/chart-only) | Preserved chart-only predecessor, with its development history sanitized for public sharing. |
| `quant_strategy_auditor` | Retained development history of the auditor integration. |

Start new work from `main` on short-lived `feat/...`, `fix/...`, or `docs/...` branches, then open a pull request back to `main`. Preserve the legacy branch as the historical chart version.

When proposing changes, describe the resulting behavior and relevant validation. Chart behavior should be checked against the supplied VNDIRECT reference, and changes to auditor storage should preserve existing sessions. Keep real session evidence and personal configuration out of examples and tests.

## Origins

This project started as **`vndirect-chart-next`**, my Next.js chart focused on reproducing VNDIRECT's observable behavior. Its original repository address was [xuanlam2007/vndirect-chart-next](https://github.com/xuanlam2007/vndirect-chart-next).

I originally called the bigger idea **VNDIRECT AI Autonomous Trading Platform**. I'm keeping both old names here because they're part of how this project started. **Quant Workspace** is the name I'm taking forward as the work grows into charts, auditing, strategy research, and AI-assisted trading.

The [chart-only branch](https://github.com/xuanlam2007/quant-workspace/tree/legacy/chart-only) preserves the predecessor rather than replacing its history.

## License

The existing [GNU GPL v3 license](LICENSE) is retained. This project is independently developed and is not an official VNDIRECT product.
