import assert from "node:assert/strict";
import test from "node:test";
import { bucketStart, mergeTick } from "./bar-builder.ts";
import { createRealtimeTickBuffer } from "./realtime-tick-buffer.ts";

test("replays a newer buffered tick from the historical last close", () => {
  const buffer = createRealtimeTickBuffer((tick) => Number(bucketStart(tick.time, "1")));
  const historicalBar = {
    time: 1_726_646_400,
    open: 1955.77,
    high: 1955.95,
    low: 1955.58,
    close: 1955.66,
    volume: 110_468,
  };
  let currentBar;

  buffer.push({ price: 1955.46, volume: 100, time: 1_726_646_460_000 }, (tick) => {
    currentBar = mergeTick(currentBar, tick.price, tick.volume, 1_726_646_460);
  });

  assert.equal(currentBar, undefined);
  currentBar = historicalBar;
  buffer.release(Number(historicalBar.time), (tick) => {
    currentBar = mergeTick(currentBar, tick.price, tick.volume, 1_726_646_460);
  });

  assert.deepEqual(currentBar, {
    time: 1_726_646_460,
    open: 1955.66,
    high: 1955.66,
    low: 1955.46,
    close: 1955.46,
    volume: 100,
  });
});

test("keeps history authoritative for buffered ticks in its latest bucket", () => {
  const buffer = createRealtimeTickBuffer((tick) => Number(bucketStart(tick.time, "1")));
  const replayed = [];

  buffer.push({ price: 1955.66, volume: 50, time: 1_726_646_430_000 }, (tick) => {
    replayed.push(tick.time);
  });
  buffer.release(1_726_646_400, (tick) => {
    replayed.push(tick.time);
  });

  assert.deepEqual(replayed, []);
});

test("bounds pending ticks and drops them after disposal", () => {
  const retained = [];
  const buffer = createRealtimeTickBuffer((tick) => tick.time, 2);

  buffer.push({ time: 1 }, (tick) => retained.push(tick.time));
  buffer.push({ time: 2 }, (tick) => retained.push(tick.time));
  buffer.push({ time: 3 }, (tick) => retained.push(tick.time));
  buffer.release(undefined, (tick) => retained.push(tick.time));
  assert.deepEqual(retained, [2, 3]);

  const disposed = createRealtimeTickBuffer((tick) => tick.time);
  disposed.push({ time: 4 }, (tick) => retained.push(tick.time));
  disposed.dispose();
  disposed.release(undefined, (tick) => retained.push(tick.time));
  assert.deepEqual(retained, [2, 3]);
});
