import assert from "node:assert/strict";
import test from "node:test";
import { StreamingIndicators } from "../components/chart/indicators/streaming-indicators.ts";
import { volumeMa, priceIndicatorData, bollingerData, macdData, rsiData } from "../components/chart/indicators/chart-indicators.ts";
import { updateReferenceSeries } from "../components/chart/indicators/reference-series-update.ts";

const fixture = (i) => ({ time: 1700000000 + i * 60, open: 100 + i / 10, high: 110 + i / 10,
  low: 90 + i / 10, close: 100 + Math.sin(i * 1.7) * 8 + i / 10, volume: (i * 137) % 1000 });

function parity(stream, bars) {
  for (const type of ["SMA", "EMA", "WMA"]) {
    for (const length of [1, 5, 20, 200]) {
      assert.deepEqual(stream.price(length, type), priceIndicatorData(bars, length, type).at(-1));
      for (const smooth of [1, 7]) assert.deepEqual(stream.volume(length, type, smooth), volumeMa(bars, length, type, smooth).at(-1));
    }
  }
  const bands = stream.bollinger();
  for (const band of ["upper", "middle", "lower"]) assert.deepEqual(bands.get(band), bollingerData(bars, band).at(-1));
  const macd = stream.macd(), full = macdData(bars);
  for (const part of ["macd", "signal", "histogram"]) {
    const expected = full[part].at(-1);
    assert.deepEqual(macd.get(part), expected && { time: expected.time, value: expected.value });
  }
  assert.deepEqual(stream.rsi(), rsiData(bars).at(-1));
}

test("matches full formulas across warmup, open-candle revisions and rollovers", () => {
  const stream = new StreamingIndicators(), bars = [];
  stream.reset(bars);
  parity(stream, bars);
  for (let i = 0; i < 230; i++) {
    bars.push(fixture(i)); stream.update(bars.at(-1)); parity(stream, bars);
    for (let tick = 0; tick < 3; tick++) {
      bars[i] = { ...bars[i], close: bars[i].close + (tick - 1) * 0.13, volume: bars[i].volume + 17 };
      stream.update(bars[i]); parity(stream, bars);
    }
  }
});

test("rebuilds after history replacement and catches up inactive calculations", () => {
  const stream = new StreamingIndicators();
  let bars = Array.from({ length: 220 }, (_, i) => fixture(i));
  stream.reset(bars); parity(stream, bars);
  for (let i = 220; i < 240; i++) { bars.push(fixture(i)); stream.update(bars.at(-1)); }
  parity(stream, bars);
  bars = Array.from({ length: 350 }, (_, i) => ({ ...fixture(i), close: 42, volume: 0 }));
  stream.reset(bars); parity(stream, bars);
  bars = [fixture(0), fixture(1)]; stream.reset(bars); parity(stream, bars);
});

test("incremental reference updates preserve corrections, projections and removals", () => {
  const point = (i) => ({ time: i, high: 3, low: 1, values: { plot: i }, colors: {} });
  const previous = [point(1), point(2)];
  const calls = [];
  const series = { setData: (data) => calls.push(["set", data]), update: (data) => calls.push(["update", data]) };
  updateReferenceSeries(series, previous, previous.map((item) => ({ ...item })));
  assert.equal(calls.length, 0);
  const next = [point(1), { ...point(2), values: { plot: 5 } }, point(3)];
  updateReferenceSeries(series, previous, next);
  assert.deepEqual(calls.splice(0), [["update", next[1]], ["update", next[2]]]);
  const correction = [{ ...point(1), values: { plot: 7 } }, point(2)];
  updateReferenceSeries(series, previous, correction);
  assert.deepEqual(calls.splice(0), [["set", correction]]);
  updateReferenceSeries(series, previous, [point(1)]);
  assert.deepEqual(calls.splice(0), [["set", [point(1)]]]);
  const projection = [{ ...point(1), isProjection: true }, point(2)];
  updateReferenceSeries(series, previous, projection);
  assert.deepEqual(calls.splice(0), [["set", projection]]);
});

test("preserves the futures 14:29 to 14:45 gap without manufacturing candles", () => {
  const at = (time) => Date.parse(`2026-09-18T${time}:00+07:00`) / 1000;
  const bars = Array.from({ length: 30 }, (_, i) => ({ ...fixture(i), time: at(`14:${String(i).padStart(2, "0")}`) }));
  const stream = new StreamingIndicators(); stream.reset(bars); parity(stream, bars);
  bars.push({ ...fixture(30), time: at("14:45") });
  stream.update(bars.at(-1)); parity(stream, bars);
  assert.equal(stream.price(20, "SMA").time, at("14:45"));
  assert.equal(bars.length, 31);
});

test("reports full-history versus incremental calculation timing", (t) => {
  const bars = Array.from({ length: 5000 }, (_, i) => fixture(i));
  const stream = new StreamingIndicators(); stream.reset(bars); stream.volume(20, "EMA", 9); stream.rsi(); stream.macd();
  const updates = Array.from({ length: 100 }, (_, i) => ({ ...bars.at(-1), close: 600 + i / 10, volume: 1000 + i }));
  const before = performance.now();
  for (const bar of updates) { bars[bars.length - 1] = bar; volumeMa(bars, 20, "EMA", 9); rsiData(bars); macdData(bars); }
  const middle = performance.now();
  for (const bar of updates) { stream.update(bar); stream.volume(20, "EMA", 9); stream.rsi(); stream.macd(); }
  const after = performance.now();
  t.diagnostic(`5000 bars, 100 revisions: full ${(middle - before).toFixed(2)}ms; incremental ${(after - middle).toFixed(2)}ms. Calculation only, not browser latency.`);
  assert.deepEqual(stream.rsi(), rsiData(bars).at(-1));
});
