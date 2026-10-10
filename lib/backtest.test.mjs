import assert from "node:assert/strict";
import test from "node:test";
import { advancePaperLedger, emptyLedger, parseReplayData, replayFrame, replayLogicalRange, submitPaperOrder } from "./backtest.ts";

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
