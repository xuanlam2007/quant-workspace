import assert from "node:assert/strict";
import test from "node:test";
import { advancePaperLedger, emptyLedger, paperLedgerContext, paperOrderMarkers, paperOrderLevels, replayIndicatorCatalog, validateReplayIndicator, submitTimedPaperOrder, parseReplayData, replayFrame, replayLogicalRange, submitPaperOrder } from "./backtest.ts";

const row = (time, close = 100) => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 5 });
const data = (bars, granularity = "1s") => parseReplayData({ symbol: "VN30F1M", granularity, bars });
const decision = (action, order_type = "MARKET", stop_price = null, limit_price = null) => ({ action, order_type, stop_price, limit_price, reason: "Evidence", question: "", drawings: [] });

test("replay overview keeps every revealed candle visible without enlarging the first candle", () => {
  for (const width of [240, 960, 1440]) {
    for (const count of [1, 15, 240, 360, 1440]) {
      const range = replayLogicalRange(count, width);
      assert.ok(range.from < 0);
      assert.ok(range.to >= count - 1);
      assert.ok(width / (range.to - range.from + 1) <= 9 + 1e-9);
      assert.equal(range.to - (count - 1), 6);
    }
  }
  assert.equal(replayLogicalRange(0, 960), null);
  assert.equal(replayLogicalRange(1, 0), null);
});

test("loaded replay starts before its first candle for minute and second sources", () => {
  for (const granularity of ["1m", "1s"]) {
    const replay = data([row(120, 100), row(180, 900)], granularity);
    const initial = replayFrame(replay, -1);
    assert.deepEqual(initial, { cutoff: 120, minute: 120, samples: [], bars: [] });
    const first = replayFrame(replay, 0);
    assert.equal(first.bars.length, 1);
    assert.equal(first.bars[0].time, 120);
    assert.deepEqual(replayFrame(replay, -1), initial);
  }
});

test("M1 is revealed only after close and contains no next-minute price", () => {
  const replay = data([row(0, 100), row(60, 900)], "1m");
  const frame = replayFrame(replay, 0);
  assert.equal(frame.cutoff, 60);
  assert.deepEqual(frame.bars, [replay.bars[0]]);
  assert.equal(frame.samples.length, 1);
});

test("second source aggregates only samples available by the analysis cutoff", () => {
  const replay = data([row(0, 100), row(54, 102), row(55, 800), row(60, 900)]);
  const frame = replayFrame(replay, 0, 55);
  assert.equal(frame.cutoff, 55);
  assert.equal(frame.bars[0].close, 102);
  assert.equal(frame.bars[0].high, 103);
  assert.equal(frame.bars[0].volume, 10);
  assert.equal(frame.bars.length, 1);
  assert.equal(replay.bars[2].close, 800);
});

test("rejects duplicate time, malformed OHLC, unaligned M1 and multi-day sources", () => {
  assert.throws(() => data([row(0), row(0)]));
  assert.throws(() => data([{ ...row(0), high: 99 }]));
  assert.throws(() => data([row(1)], "1m"));
  assert.throws(() => data([row(0), row(86400)]));
  assert.throws(() => data([{ ...row(0), volume: NaN }]));
});

test("market executes only at a later sample, never retroactively at submission", () => {
  const replay = data([row(54, 100), row(55, 101)]);
  const ledger = submitPaperOrder(emptyLedger(), decision("OPEN_LONG"), 55);
  const result = advancePaperLedger(ledger, replay, 54, 56, .45);
  assert.equal(result.orders[0].filled, 56);
  assert.equal(result.position.price, 101);
  assert.equal(ledger.orders[0].status, "waiting");
});

test("Stop-Limit activation and filling require different available samples", () => {
  const replay = data([row(55, 105), row(56, 106), row(57, 104)]);
  const order = submitPaperOrder(emptyLedger(), decision("OPEN_LONG", "STOP_LIMIT", 104, 105), 55);
  const triggered = advancePaperLedger(order, replay, 55, 56, .45);
  assert.equal(triggered.orders[0].status, "triggered");
  assert.equal(triggered.position, null);
  const gap = advancePaperLedger(triggered, replay, 56, 57, .45);
  assert.equal(gap.orders[0].status, "triggered");
  const filled = advancePaperLedger(gap, replay, 57, 58, .45);
  assert.equal(filled.orders[0].price, 104);
  assert.equal(filled.orders[0].triggered, 56);
  assert.equal(filled.orders[0].filled, 58);
});

test("OHLC touching stop or limit does not invent intrabar fills", () => {
  const replay = data([{ ...row(55, 100), high: 110, low: 90 }]);
  const stop = submitPaperOrder(emptyLedger(), decision("OPEN_LONG", "STOP_LIMIT", 105, 105), 55);
  assert.equal(advancePaperLedger(stop, replay, 55, 56, .45).orders[0].status, "waiting");
  const limit = submitPaperOrder(emptyLedger(), decision("OPEN_LONG", "LIMIT", null, 95), 55);
  assert.equal(advancePaperLedger(limit, replay, 55, 56, .45).position, null);
});

test("short closed-pair points use direction and charge one fee on close", () => {
  const replay = data([row(55, 105), row(56, 101)]);
  const opened = advancePaperLedger(submitPaperOrder(emptyLedger(), decision("OPEN_SHORT"), 55), replay, 55, 56, .45);
  assert.equal(opened.pairs.length, 0);
  const closed = advancePaperLedger(submitPaperOrder(opened, decision("CLOSE"), 56), replay, 56, 57, .45);
  assert.deepEqual(closed.pairs, [{ open: 56, close: 57, gross: 4, fee: .45 }]);
  assert.equal(closed.position, null);
  assert.throws(() => advancePaperLedger(closed, replay, 57, 58, Infinity));
});

test("cancel preserves a filled position and cancels only pending orders", () => {
  const replay = data([row(55)]);
  const opened = advancePaperLedger(submitPaperOrder(emptyLedger(), decision("OPEN_LONG"), 55), replay, 55, 56, .45);
  const pending = submitPaperOrder(opened, decision("CLOSE", "LIMIT", null, 110), 56);
  assert.throws(() => submitPaperOrder(pending, decision("OPEN_LONG"), 56));
  const cancelled = submitPaperOrder(pending, decision("CANCEL"), 56);
  assert.equal(cancelled.orders[0].status, "filled");
  assert.equal(cancelled.orders[1].status, "cancelled");
  assert.deepEqual(cancelled.position, opened.position);
});


test("a delayed AI entry submits at arrival and cannot fill in elapsed candles", () => {
  const replay = data([row(0, 100), row(60, 200), row(120, 300), row(180, 400)], "1m");
  const snapshot = emptyLedger();
  const current = advancePaperLedger(snapshot, replay, 60, 180, .45);
  const submitted = submitTimedPaperOrder(current, decision("OPEN_LONG"), paperLedgerContext(snapshot), 60, 180);
  assert.equal(submitted.orders[0].submitted, 180);
  assert.equal(advancePaperLedger(submitted, replay, 60, 180, .45).position, null);
  const filled = advancePaperLedger(submitted, replay, 180, 240, .45);
  assert.equal(filled.position.price, 400);
  assert.equal(filled.orders[0].filled, 240);
});

test("a delayed decision never overwrites a fill or a manual cancellation", () => {
  const snapshot = submitPaperOrder(emptyLedger(), decision("OPEN_LONG"), 60);
  const context = paperLedgerContext(snapshot);
  const filled = advancePaperLedger(snapshot, data([row(60, 110)], "1m"), 60, 120, .45);
  assert.throws(() => submitTimedPaperOrder(filled, decision("OPEN_SHORT"), context, 60, 120), /Ledger/);
  assert.equal(filled.position.side, "LONG");
  const cancelled = submitPaperOrder(snapshot, decision("CANCEL"), 120);
  assert.throws(() => submitTimedPaperOrder(cancelled, decision("OPEN_SHORT"), context, 60, 120), /Ledger/);
  assert.equal(cancelled.orders[0].status, "cancelled");
});

test("question decisions do not trade and replay rewind rejects late orders", () => {
  const ledger = emptyLedger();
  assert.equal(submitTimedPaperOrder(ledger, { ...decision("OPEN_LONG"), question: "Missing rule" }, paperLedgerContext(ledger), 60, 120), ledger);
  assert.throws(() => submitTimedPaperOrder(ledger, decision("OPEN_LONG"), paperLedgerContext(ledger), 120, 60), /Ledger/);
});

test("chart markers distinguish submission and fill without exposing future execution", () => {
  const replay = data([row(0, 100), row(60, 110), row(120, 120)], "1m");
  const submitted = submitPaperOrder(emptyLedger(), decision("OPEN_LONG"), 60);
  const filled = advancePaperLedger(submitted, replay, 60, 120, .45);
  const before = paperOrderMarkers(filled.orders, replayFrame(replay, 0), "1m");
  assert.equal(before.length, 1);
  assert.equal(before[0].time, 0);
  assert.equal(before[0].shape, "square");
  assert.match(before[0].text, /100.*gửi/);
  const after = paperOrderMarkers(filled.orders, replayFrame(replay, 1), "1m");
  assert.equal(after.length, 2);
  assert.equal(after[1].time, 60);
  assert.equal(after[1].shape, "arrowUp");
  assert.match(after[1].text, /110.*khớp/);
});

test("second-source markers preserve the observed submission price within one candle", () => {
  const replay = data([row(54, 100), row(55, 110), row(56, 999)]);
  const submitted = submitPaperOrder(emptyLedger(), decision("OPEN_SHORT"), 55);
  const filled = advancePaperLedger(submitted, replay, 55, 56, .45);
  const markers = paperOrderMarkers(filled.orders, replayFrame(replay, 0, 60), "1s");
  assert.equal(markers.length, 2);
  assert.ok(markers.every(marker => marker.time === 0));
  assert.match(markers[0].text, /100.*gửi/);
  assert.match(markers[1].text, /110.*khớp/);
  assert.equal(markers[1].shape, "arrowDown");
  assert.equal(paperOrderMarkers([{ ...submitted.orders[0], submitted: 61 }], replayFrame(replay, 0, 60), "1s").length, 0);
});

test("every submitted order has a unique marker and waiting Market reference level", () => {
  const replay = data([row(0, 100), row(60, 110)], "1m");
  const submitted = submitPaperOrder(emptyLedger(), decision("OPEN_LONG"), 60);
  const current = replayFrame(replay, 0);
  assert.equal(paperOrderMarkers(submitted.orders, current)[0].id, "order-1-submitted");
  assert.match(paperOrderMarkers(submitted.orders, current)[0].text, /order-1.*gửi/);
  assert.equal(paperOrderLevels(submitted.orders, current)[0].price, 100);
  assert.match(paperOrderLevels(submitted.orders, current)[0].title, /order-1.*chờ khớp/);
  const filled = advancePaperLedger(submitted, replay, 60, 120, .45);
  assert.equal(paperOrderLevels(filled.orders, replayFrame(replay, 1)).length, 0);
  assert.deepEqual(paperOrderMarkers(filled.orders, replayFrame(replay, 1)).map(marker => marker.id), ["order-1-submitted", "order-1-filled"]);
  assert.equal(paperOrderLevels([{ ...submitted.orders[0], submitted: 121 }], current).length, 0);
});

test("registered indicator defaults work and inputs reject unknown fields, types and ranges", () => {
  for (const entry of replayIndicatorCatalog) assert.doesNotThrow(() => validateReplayIndicator({ id: "fixture", name: entry.name, inputs: [], visible: true, operation: "upsert" }));
  const indicator = { id: "rsi", name: "Relative Strength Index", inputs: [{ id: "length", value: 14 }], visible: true, operation: "upsert" };
  assert.doesNotThrow(() => validateReplayIndicator(indicator));
  for (const inputs of [[{ id: "command", value: "shell" }], [{ id: "length", value: "14" }], [{ id: "length", value: 0 }], [{ id: "length", value: Infinity }], [{ id: "length", value: 2.5 }], [{ id: "length", value: 14 }, { id: "length", value: 15 }], [{ id: "smoothingLine", value: "OTHER" }]]) assert.throws(() => validateReplayIndicator({ ...indicator, inputs }));
  assert.throws(() => validateReplayIndicator({ ...indicator, name: "Unknown Indicator" }));
});
