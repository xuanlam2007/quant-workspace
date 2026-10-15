import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { routeSchema, validateQuery, backtestFrameSchema } from "./engine-schemas.ts";
import { historyQuery, queryObject } from "./history-schema.ts";

test("Backtest admits quantity and conditional metadata without admitting broker fields", () => {
  const order = { id: "order-1", side: "BUY", purpose: "OPEN", type: "STOP_LIMIT", stop: 101, limit: 102, submitted: 60, triggered: null, status: "waiting", filled: null, price: null, quantity: 3, strategy: "trailing", trailing: { amount: 1, spread: 1, anchor: 100 } };
  const frame = { symbol: "VN30F1M", cutoff: 120, granularity: "1m", bars: [{ time: 60, open: 100, high: 100, low: 100, close: 100, volume: 1 }], image: "", drawings: [], position: { side: "LONG", price: 100, time: 60, quantity: 3 }, orders: [order], teaching: "", history: [] };
  assert.equal(backtestFrameSchema.safeParse(frame).success, true);
  for (const quantity of [0, 1001, 1.5]) {
    assert.equal(backtestFrameSchema.safeParse({ ...frame, orders: [{ ...order, quantity }] }).success, false);
    assert.equal(backtestFrameSchema.safeParse({ ...frame, position: { ...frame.position, quantity } }).success, false);
  }
  assert.equal(backtestFrameSchema.safeParse({ ...frame, orders: [{ ...order, account: "broker" }] }).success, false);
  assert.equal(backtestFrameSchema.safeParse({ ...frame, orders: [{ ...order, trailing: { ...order.trailing, command: "shell" } }] }).success, false);
});

test("Quant MCP browser routes reject unknown fields and remain Backtest-only", () => {
  const client_id = "d84808fa-b8a7-4c72-8f77-82a9998c066f";
  const frame = { client_id, symbol: "TEST", cutoff: 120, granularity: "1m", bars: [{ time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 }], image: "", drawings: [], position: null, orders: [], teaching: "", history: [] };
  assert.equal(backtestFrameSchema.safeParse({ ...frame, replay_id: client_id }).success, true);
  assert.equal(backtestFrameSchema.safeParse({ ...frame, replay_id: "invalid" }).success, false);
  for (const [path, body] of [["/backtest/tools/sync", { client_id, frame }], ["/backtest/tools/ack", { client_id, frame, command_id: client_id, error: "" }], ["/backtest/tools/reset", { client_id }]]) {
    const schema = routeSchema("backtest", "POST", path);
    assert.equal(schema.safeParse(body).success, true);
    for (const key of ["capability", "effective_time", "provider", "url", "command"]) assert.equal(schema.safeParse({ ...body, [key]: "forbidden" }).success, false);
    assert.equal(routeSchema("auditor", "POST", path), null);
  }
  const indicator = { id: "rsi", name: "Relative Strength Index", inputs: [], visible: true, operation: "upsert", values: [{ time: 60, values: { rsi: 50 } }] };
  assert.equal(backtestFrameSchema.safeParse({ ...frame, indicators: [indicator] }).success, true);
  assert.equal(backtestFrameSchema.safeParse({ ...frame, indicators: [{ ...indicator, values: [{ time: 60, values: { rsi: Infinity } }] }] }).success, false);
});

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


test("Backtest drawing tools accept zones, Fibonacci and annotations with strict anchors", () => {
  const schema = routeSchema("backtest", "POST", "/backtest/analyze");
  const input = { symbol: "VN30F1M", cutoff: 120, granularity: "1m", bars: [{ time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 }], image: "PNG", drawings: [], position: null, orders: [], teaching: "", history: [] };
  for (const tool of ["Arrow", "Rectangle", "FibRetracement", "Text", "HorizontalRay", "VerticalLine", "CrossLine"]) {
    const onePoint = ["Text", "HorizontalRay", "VerticalLine", "CrossLine"].includes(tool);
    const drawing = { id: "setup", tool, points: [{ timestamp: 60, price: 100 }, ...(onePoint ? [] : [{ timestamp: 90, price: 101 }])], label: "Setup" };
    assert.equal(schema.safeParse({ ...input, drawings: [drawing] }).success, true, tool);
    assert.equal(schema.safeParse({ ...input, drawings: [{ ...drawing, shell: "forbidden" }] }).success, false);
    assert.equal(schema.safeParse({ ...input, drawings: [{ ...drawing, points: [{ ...drawing.points[0], future: true }] }] }).success, false);
  }
  assert.equal(schema.safeParse({ ...input, drawings: [{ id: "bad", tool: "Rectangle", points: [{ timestamp: 60, price: 100 }], label: "" }] }).success, false);
  assert.equal(schema.safeParse({ ...input, drawings: [{ id: "bad", tool: "UnknownTool", points: [{ timestamp: 60, price: 100 }], label: "" }] }).success, false);
});

test("full drawing and indicator commands remain strict at the request boundary", () => {
  const input = { symbol: "TEST", cutoff: 120, granularity: "1m", bars: [{ time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 }], image: "PNG", drawings: [], position: null, orders: [], teaching: "", history: [] };
  for (const [tool, count] of [["Callout", 2], ["PriceNote", 2], ["PriceRange", 2], ["PriceLabel", 1], ["LongShortPosition", 3]]) {
    const drawing = { id: "tool", tool, points: Array.from({ length: count }, (_, i) => ({ timestamp: 60 + i, price: 100 + i })), label: "Fixture" };
    assert.equal(backtestFrameSchema.safeParse({ ...input, drawings: [drawing] }).success, true);
    assert.equal(backtestFrameSchema.safeParse({ ...input, drawings: [{ ...drawing, points: [] }] }).success, false);
  }
  const indicator = { id: "rsi", name: "Relative Strength Index", inputs: [{ id: "length", value: 14 }], visible: true, operation: "upsert" };
  assert.equal(backtestFrameSchema.safeParse({ ...input, indicators: [indicator] }).success, true);
  for (const extra of [{ shell: "forbidden" }, { code: "forbidden" }, { inputs: [{ id: "length", value: "14" }] }, { name: "Unknown" }]) assert.equal(backtestFrameSchema.safeParse({ ...input, indicators: [{ ...indicator, ...extra }] }).success, false);
});
