# Local workspace security

This application is a local, single-user trading research workspace. The Next dev/start commands bind to `127.0.0.1`; the Python engines also bind to loopback. Do not expose it through a public tunnel or reverse proxy without a separate authenticated deployment design. Browser origin checks and the engine token protect the local API boundary; they are not a multi-user authorization system.

## Environment exposure inventory

The inventory covers application, launcher and Python source, root `.env*` files, and the private adapter's environment-access references. Values and private document contents are intentionally omitted. The local environment files currently define only the three market-data configuration names below.

| Variable | Purpose and boundary | Browser exposure |
| --- | --- | --- |
| `MARKET_DATA_API_URL` | Server-only history/symbol upstream | None through the client configuration |
| `MARKET_DATA_SOCKET_URL` | Direct market-data Socket.IO transport | Validated public endpoint returned by `/api/dchart/provider` |
| `MARKET_DATA_PROVIDER_NAME` | User-facing source label | Display label returned by `/api/dchart/provider` |
| `MARKET_DATA_API_TOKEN` | Optional upstream Bearer authentication, read only by `lib/server/market-data.ts` | None; attached only to server fetches |
| `AUDITOR_ENGINE_URL`, `BACKTEST_ENGINE_URL` | Server-only loopback engine endpoints | HTTP endpoints hidden behind same-origin routes; Auditor WebSocket origin necessarily visible during connection |
| `NEXT_PUBLIC_AUDITOR_ENGINE_URL`, `NEXT_PUBLIC_BACKTEST_ENGINE_URL` | Deprecated server-only fallback names for existing installations | No client source reference or build-time interpolation; same validated WebSocket transport exception |
| `QUANT_ENGINE_TOKEN` | Next-to-engine authentication; generated in ignored `.agents/engine-token` when unset | Never returned; browser receives a single-use 30-second WebSocket ticket instead |
| `AUDITOR_PYTHON`, `BACKTEST_PYTHON` | Server launcher executable | None |
| `AUDITOR_AUTOSTART`, `BACKTEST_AUTOSTART` | Server launch policy | Only resulting readiness/manual status |
| `AUDITOR_UI_URL`, `BACKTEST_UI_URL` | Local browser launch, CORS and monitor origin | Local UI address when opening/redirecting, no credentials |
| `AUDITOR_OPEN_BROWSER` | Python browser launch switch | None |
| `QUANT_OBSERVER_MEDIA_PATHS` | CLI observer hook's explicitly allowed temporary evidence paths | None |
| `NEXT_DIST_DIR`, `PYTHONUNBUFFERED`, `NODE_OPTIONS` | Runtime/build/launcher settings | No application values returned |
| `PATH`, `LocalAppData`, `ProgramFiles`, `ProgramFiles(x86)` | Executable discovery on Windows | No values returned by configuration responses |
| `NODE_ENV` | Framework development/production mode | Framework mode is public by design; never put a secret here |

Provider CLI credentials remain in the CLI's existing account store or provider-specific environment. The application does not serve those stores or keys. CLI subprocesses retain provider credentials and system variables but exclude the application prefixes `QUANT_ENGINE_`, `MARKET_DATA_`, `NEXT_PUBLIC_`, `AUDITOR_`, and `BACKTEST_`. Other inherited OS variables are runtime inputs, not application configuration responses.

Use `AUDITOR_ENGINE_URL` and `BACKTEST_ENGINE_URL` rather than the deprecated public-prefixed names. Engine endpoints must be loopback HTTP(S) origins without credentials, path, query or fragment. Market endpoints also reject credentials/query/fragment. The browser market socket is suitable for a public feed only; authenticated private market sockets would need a server-side streaming relay, not a token added to this URL.

The exposure statements describe the source boundary. No new production build or browser session was run as part of this change. Old generated bundles can retain old code until the dev server is restarted or a separately approved build is produced.

## Request contracts

Next routes use strict Zod objects; Python routes use `StrictRequest` with `extra="forbid"` and strict types. Nested drawing, fill and replay objects also reject unknown fields. Semantic checks for sessions, capture generation, audio format/time, replay cutoff, future candles and simulated orders remain enforced by the Python handlers. The proxy exposes an explicit method/path allowlist, not an arbitrary engine URL.

| Route group | Client-owned fields |
| --- | --- |
| Engine startup, session creation/export, AI connection test | No body or `{}` only |
| AI configuration | `provider`, `model`, `effort`; selected values must exist in the CLI catalog |
| Terminal preference | `terminal_type` only |
| Terminal open | `terminal_type`, `purpose`, `provider`; always interactive CLI, no automatic login/logout commands |
| Mode/source | `mode`, `target_window_id`, `browser_source_id`; server resolves native window metadata |
| Recording | `action`, `source_id`, `browser_only`, `capture_generation` |
| Recording preference / strategy mode | `auto_start` / `enabled` respectively |
| Session switch / saved-event analysis | `date`, `session_id`, validated against stored sessions |
| Observation | Reason, PNG evidence and identifiers for the current session/source/generation |
| Audio start | Current session/date/source/generation identifiers |
| Audio upload / sampled frame | Bounded encoded media, format and capture times; token identifies the server-created recording |
| Fill review | Candidate identifier, confirm/exclude choice and reviewed execution facts; server validates candidate/session and computes totals |
| Legacy trade / WebSocket drawing | Bounded trade or typed drawing facts, current source/session identity; no arbitrary event object |
| WebSocket ticket | `client_id` only; server creates expiring single-use ticket |
| Backtest analysis | Visible replay bars/chart/drawings, local simulator context and user explanation; server controls provider, strategy and decision output |

Clients cannot set stored event IDs, local file paths, warnings, AI status/results, connection readiness, strategy documents/rules, system prompts, fees, computed PnL, reviewed-by attribution, model-used metadata or executable commands. Those fields are absent from their route-specific input contracts. Session/source identifiers are concurrency checks, not permission to select arbitrary files. Backtest positions/orders are client simulator context, not evidence of real broker executions or authority to send live orders.

Bodies are bounded to 32 MiB before schema parsing, with smaller field limits and 1 KiB startup/socket requests. Nonempty bodies require JSON objects and JSON content type. Empty-body routes reject injected fields; bodyless methods reject payloads. Validation responses omit input values. GET AI status is read-only; connection checks use POST. Next rejects cross-origin requests and nonlocal workspace hosts. Python requires the engine token for API requests; WebSockets require an allowed origin and a matching unused ticket. Audio, reports and screenshots use the authenticated server proxy. HTML reports use a sandbox CSP with no scripts.

## Dependency locking and local fixes

Direct registry dependencies use exact versions, Git chart plugins use full commit hashes, `.npmrc` enables exact saves and a package lock, and `package-lock.json` records transitive resolutions/integrity. Use `npm ci` for reproducible installs, do not discard the lockfile. Local security packages are immutable tarball dependencies referenced by `$braces` and `$parseuri` overrides, avoiding npm's relative-directory override/link resolution bug.

Next.js and its ESLint configuration are patched to `16.3.8`; security overrides select `sharp@0.35.5`, `source-map-js@1.2.2`, and `brace-expansion@5.0.12` for the affected newer major range. Older compatible brace-expansion consumers retain their already-patched versions.

`braces@3.0.3` has no upstream patched release for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). `vendor/braces` retains the upstream MIT license and applies bounded parser/walker depth, including caller-supplied ASTs. `vendor/braces-3.0.3-quant.1.tgz` contains that local mitigation; it is not a claim of an upstream fix. Regression tests cover deep/unclosed groups, cyclic ASTs, ordinary glob compatibility and actual transitive resolution. Repack the archive and update the lock whenever its source changes. Replace it with a published patched release when available and validated.

The existing `vendor/parseuri` replacement is also integrity-locked as `vendor/parseuri-2.0.0.tgz`; Socket.IO keeps its existing protocol and consumer contract. Dependency installs for this batch used `--ignore-scripts`; no dependency build or project build was run. A loaded older SWC binary prevented npm from deleting its temporary backup directory on Windows. The running application was not terminated.

## Cleanup and code-quality workflow

Removed the unreferenced `scripts/auditor-dev.mjs` launcher and `engine/gemini_analyzer.py` compatibility alias. Shared engine startup now has one implementation with independent per-engine state. Removed the upstream braces debug print, unsafe stderr reflection and a stale generated dev log for an inactive port. Trading evidence, sessions, strategies, private adapters and active diagnostic logs were preserved.

The installed ECC `coding-standards` skill is the best available fit for code cleanup: use explicit names, readable contracts, justified abstractions and shared implementations. Pair it with `security-review` for input and secret boundaries. This change applies those principles to the security scope; it does not claim a wholesale refactor of every chart feature. UI changes continue to require the project's three confirmed UI skills and existing components. Validation and commit-message preparation remain delegated to Luna with the project's approval workflow.
