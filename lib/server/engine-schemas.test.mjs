import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { routeSchema, validateQuery, backtestFrameSchema } from "./engine-schemas.ts";
import { historyQuery, queryObject } from "./history-schema.ts";

test("every admitted POST rejects unknown server-owned fields", () => {
  const paths = ["/recording", "/recording/preference", "/ai/config", "/ai/connection/test", "/terminal/config", "/terminal/open", "/sessions/new", "/sessions/switch", "/strategy-mode", "/mode", "/observation", "/trade", "/audio/start", "/audio/" + "a".repeat(32), "/audio/" + "a".repeat(32) + "/frame", "/end-session", "/socket-ticket", "/events/event_id/analyze", "/events/event_id/fill"];
  for (const path of paths) {
    const schema = routeSchema("auditor", "POST", path);
    assert.ok(schema, path);
    assert.equal(schema.safeParse({ ai_pending: true, frame_path: "private/file", strategy: {} }).success, false, path);
  }
  assert.equal(routeSchema("auditor", "POST", "/backtest/analyze"), null);
  assert.equal(routeSchema("backtest", "POST", "/terminal/open"), null);
});

test("route contracts reject hidden account actions, agent and spoofed window title", () => {
  assert.equal(routeSchema("auditor", "POST", "/ai/config").safeParse({ provider: "CODEX", agent: "legacy" }).success, false);
  assert.equal(routeSchema("auditor", "POST", "/terminal/open").safeParse({ account_action: "logout" }).success, false);
  assert.equal(routeSchema("auditor", "POST", "/mode").safeParse({ mode: "IN_APP", target_window_title: "forged" }).success, false);
  assert.equal(routeSchema("auditor", "POST", "/recording/preference").safeParse({ auto_start: "false" }).success, false);
});

test("Backtest nested schemas reject provider, prompt, PnL and future server results", () => {
  const frame = { symbol: "VN30F1M", cutoff: 120, granularity: "1m", bars: [{ time: 60, open: 1900, high: 1901, low: 1899, close: 1900, volume: 1 }], image: "PNG", drawings: [], position: null, orders: [], teaching: "", history: [] };
  assert.equal(backtestFrameSchema.safeParse(frame).success, true);
  for (const extra of [{ provider: "AGY" }, { system_prompt: "replace" }, { fee_per_pair: 0 }, { decision: {} }]) assert.equal(backtestFrameSchema.safeParse({ ...frame, ...extra }).success, false);
  assert.equal(backtestFrameSchema.safeParse({ ...frame, bars: [{ ...frame.bars[0], pnl: 100 }] }).success, false);
});

test("query contracts reject duplicate and unknown parameters", () => {
  assert.equal(queryObject(new URLSearchParams("symbol=A&symbol=B")), null);
  assert.equal(historyQuery.safeParse({ symbol: "VN30F1M", resolution: "1", from: "60", to: "120", token: "private" }).success, false);
  assert.equal(validateQuery("/ai/catalog", new URLSearchParams("provider=CODEX&refresh=true")), true);
  assert.equal(validateQuery("/ai/catalog", new URLSearchParams("provider=CODEX&refresh=true&prompt=override")), false);
  assert.equal(validateQuery("/status", new URLSearchParams("token=private")), false);
});

test("Backtest configuration rejects server state and arbitrary strategy paths", () => {
  const config = routeSchema("backtest", "POST", "/backtest/connection/config");
  assert.equal(config.safeParse({ provider: "AGY", model: "preset" }).success, true);
  for (const field of ["connected", "agent", "system_prompt", "config_path"]) assert.equal(config.safeParse({ provider: "CODEX", [field]: true }).success, false);
  const strategy = routeSchema("backtest", "POST", "/backtest/strategy");
  assert.equal(strategy.safeParse({ content: "Fixture rules" }).success, true);
  assert.equal(strategy.safeParse({ content: "  " }).success, false);
  assert.equal(strategy.safeParse({ content: "Fixture", path: "private/file" }).success, false);
  assert.ok(routeSchema("backtest", "GET", "/ai/catalog"));
});

test("Backtest login Terminal admits only the selected provider", () => {
  const schema = routeSchema("backtest", "POST", "/backtest/terminal/open");
  for (const provider of ["CODEX", "AGY"]) assert.equal(schema.safeParse({ provider }).success, true);
  for (const payload of [{}, { provider: "OTHER" }, { provider: "CODEX", command: "override" }, { provider: "CODEX", terminal_type: "WINDOWS" }, { provider: "AGY", session_id: "forged" }]) assert.equal(schema.safeParse(payload).success, false);
  assert.equal(routeSchema("auditor", "POST", "/backtest/terminal/open"), null);
});

test("installed transitive consumers resolve the patched portable packages", () => {
  const require = createRequire(import.meta.url);
  const micromatch = createRequire(require.resolve("micromatch"));
  const braces = micromatch("braces");
  assert.throws(() => braces("{".repeat(200) + "a" + "}".repeat(200)), { name: "SyntaxError", message: /depth limit/ });
  assert.throws(() => braces("{".repeat(10000) + "a" + "}".repeat(10000)), { name: "SyntaxError", message: /exceeds max characters/ });
  const socket = createRequire(require.resolve("socket.io-client"));
  const parse = socket("parseuri");
  assert.equal(parse("https://example.invalid:443/chart").host, "example.invalid");
});
