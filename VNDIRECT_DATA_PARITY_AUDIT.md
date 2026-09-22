# VNDIRECT Data Parity Audit

## Scope

This report compares the chart application's data behavior with the reverse-engineered VNDIRECT chart bundle and captured network responses. It covers history, realtime ticks, candle construction, sessions, symbols, ranges, and indicators.

Reference bundle:

- `C:\Users\xlam\Desktop\trading view\reverse-engineered vndirect\network js\main.c5b22593.js`
- `C:\Users\xlam\Desktop\trading view\reverse-engineered vndirect\js\network_files\0033_main.5bd31da3.js`

## Behavior That Matches

- Uses the VNDIRECT history endpoint and its OHLCV arrays.
- Keeps history timestamps in Unix seconds.
- Normalizes realtime millisecond timestamps to seconds.
- Uses epoch buckets for intraday and daily resolutions.
- Creates a new realtime candle with the previous close as its open.
- Includes the opening value and incoming price when calculating high and low.
- Adds incoming tick volume to the current candle volume.
- Ignores ticks older than the active candle.
- Buffers realtime ticks while history is loading, then applies newer buckets after history is ready.
- Keeps the realtime connection active when only the displayed range or resolution changes.
- Formats chart time using the `Asia/Bangkok` timezone.

## Confirmed Differences

| Area | VNDIRECT bundle behavior | Current application behavior | Impact |
| --- | --- | --- | --- |
| Footer presets | Changes range and resolution together: `5y/1y -> W`, `3m/1m -> D`, `5d -> 5`, `1d -> 1` | Changes only the requested range | High: selecting `1d` while on daily resolution produces daily, not one-minute, candles |
| History loading | TradingView asks for additional history when the user pans left | Fetches one fixed range for each symbol, resolution, or range change | High: earlier candles cannot load dynamically |
| Symbol metadata | Resolves `/dchart/symbols` for session, exchange, price scale, and capabilities | Uses hard-coded exchange and price formatting | High for futures and non-HOSE symbols |
| Intraday session | Symbol metadata declares `0900-1500` | Explicitly accepts `0900-1130` and `1300-1445` | High: closing-auction ticks after `14:45` can be omitted |
| Weekly and monthly history | Requests `W` and `M` from the history endpoint | Fetches daily bars and aggregates locally | Intentional compatibility change, not an exact bundle port |
| Weekly and monthly realtime bucket | Uses fixed epoch-sized 7-day and 30-day buckets | Uses calendar Monday and calendar-month buckets | Candle timestamp boundaries differ |
| History error | Calls the datafeed error callback | Continues with empty history and socket-only candles | High: failed loading can look like valid incomplete data |
| Indicators | Uses TradingView built-in studies | Uses custom MA, MACD, RSI, and Bollinger calculations | Values and warm-up points can differ slightly |
| Volume smoothing | Uses TradingView Volume study inputs | Persists and displays `smoothingLength`, but calculation always uses SMA length | Setting currently has no data effect |
| Request caching | Caches an identical history URL for two seconds | Does not cache | Extra requests, normally no value difference |
| Realtime architecture | Shared Socket.IO client with subscriber routing and retry policy | One manual WebSocket connection for the selected symbol | Reconnect and multi-symbol behavior differ |

## Live API Finding: Weekly and Monthly Requests

The current history endpoint responds with the following for direct weekly and monthly requests:

```text
W: Not support resolution W
M: Not support resolution M
```

The local daily-to-week/month aggregation is therefore needed for those resolutions to work with the current API. It differs from the bundle, whose datafeed still sends `W` and `M` requests.

## Session Finding

The `/dchart/symbols?symbol=VN30` response currently includes:

```json
{
  "timezone": "Asia/Bangkok",
  "minmov": 1,
  "pricescale": 100,
  "session": "0900-1500",
  "supported_resolutions": ["1", "5", "15", "30", "60", "D", "W", "M"]
}
```

Captured one-minute history also contains zero-volume `15:05` settlement bars. The application removes them, but it also removes any realtime data from `14:46` through `15:00`. This is not equivalent to the symbol metadata used by VNDIRECT.

## Recommended Fix Order

1. Make footer presets change resolution exactly like VNDIRECT.
2. Resolve and use dynamic symbol metadata, including exchange, price scale, and session.
3. Replace the fixed intraday cutoff with metadata-aware session handling.
4. Add history pagination when the user pans left.
5. Show history load failures instead of rendering a socket-only fallback.
6. Make `smoothingLength` affect the volume study, or remove the setting.
7. Align custom indicator initialization and precision with TradingView where observable parity is required.

## Limits of Exact Parity

VNDIRECT uses TradingView's proprietary chart and study engines, while this application uses Lightweight Charts and custom indicator implementations. Exact bit-for-bit parity for indicator warm-up, timescale layout, and internal study precision is not technically possible. Historical OHLCV, realtime candle transitions, session rules, and visible interaction behavior can still be matched closely.

## Implementation Report, 2026-09-22

The actionable differences in this audit have been implemented:

- Footer presets now change both range and resolution using VNDIRECT's exact mapping.
- Panning to the left requests and merges older history pages without replacing newer realtime bars.
- Symbol metadata now controls exchange, session, timezone, price precision, and minimum price movement.
- Intraday filtering now follows the resolved symbol session through `15:00`.
- Weekly and monthly requests try the native resolution first, then fall back to daily aggregation when the current API reports that the resolution is unsupported.
- Weekly and monthly history and realtime bars use the bundle's fixed epoch buckets.
- History errors clear stale data and display an explicit error instead of silently creating a socket-only chart.
- Identical successful and no-data history responses are cached for two seconds.
- Volume MA now applies the selected average type and smoothing length.
- Realtime data now uses a shared Socket.IO v2 connection with symbol reference counting, `addsymbol`, `removesymbol`, and reconnect handling.
- The chart header now reports the live VNDIRECT Socket.IO connection state immediately before the settings button.
- Same-origin API routes proxy metadata and history because the upstream service rejects direct localhost browser requests.
- Development servers use a separate build directory per port so parallel instances cannot corrupt the Webpack cache or temporarily remove CSS.

The only intentional limitation is the proprietary TradingView study engine. Study inputs and standard formulas are aligned, but internal TradingView warm-up and rounding behavior cannot be copied exactly into Lightweight Charts.

## Verification Evidence

The audit above was the source plan. The tested user journeys were: selecting a VNDIRECT range produces the expected resolution, symbol metadata controls chart data rules, scrolling left loads older candles, failed history never appears as valid data, and realtime ticks continue the historical series without duplicate volume.

The initial regression suite failed because metadata and merge exports were missing. A later weekly/monthly regression failed because the application still used calendar buckets. After implementation, the same targets passed with the results below.

| Guarantee | Validation | Result |
| --- | --- | --- |
| Presets, sessions, metadata, caching, merge behavior, indicators, socket normalization, connection labels, and W/M buckets | `node --experimental-test-coverage --test lib/chart-data-parity.test.mjs lib/realtime-tick-buffer.test.mjs` | 16 passed, 87.93% line coverage |
| Isolated development cache | `node --test scripts/next-dev.test.mjs` | 2 passed |
| Type safety | `npx tsc --noEmit --incremental false` | Passed |
| Production compilation and routes | `npm run build` | Passed, four application routes generated |
| Parallel development startup | `npm run dev` while port 3000 was occupied | Served port 3001 from `.next-dev-3001`, HTTP 200 |
| CSS and chart rendering | Headless Chrome runtime check | App and chart canvas rendered, no chart data error |
| Footer mapping | Headless Chrome runtime check | `1n -> 1m`, `5y -> 1W` |
| Historical backfill | Headless Chrome runtime check | Two older one-minute pages loaded after scrolling left |
| Weekly fallback | Headless Chrome runtime check | Native `W` request followed by successful `D` fallback |
| Realtime transport | Chrome network inspection | One Socket.IO connection upgraded from polling to WebSocket |
| Proxy input validation | Invalid symbol, resolution, and oversized range requests | All rejected with HTTP 400 |

The repository's current `npm run lint` command invokes the deprecated interactive `next lint` setup prompt, so it cannot run non-interactively until an ESLint configuration is added. The production build still completed Next.js type and validity checks.
