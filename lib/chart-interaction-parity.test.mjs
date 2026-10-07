import assert from "node:assert/strict";
import test from "node:test";
import { alignComparisonPoints, comparisonValueAt } from "../components/chart/core/chart-utils.ts";
import { DRAWING_HISTORY_VERSION, drawingHistoryDay, restoreDrawingHistory } from "../components/chart/drawing/drawing-history.ts";

const epoch = (time) => Date.parse(time) / 1000;
const mainTimes = ["2026-10-06T07:29:00Z", "2026-10-06T07:45:00Z"].map(epoch);
const points = [
  { time: mainTimes[0], value: 1900 },
  { time: epoch("2026-10-06T07:30:00Z"), value: 1901 },
  { time: epoch("2026-10-06T07:38:00Z"), value: 1902 },
];

test("Compare adopts the latest earlier value without adding 14:30-14:44 axis slots", () => {
  assert.deepEqual(alignComparisonPoints(points, mainTimes), [
    { time: mainTimes[0], value: 1900 }, { time: mainTimes[1], value: 1902 },
  ]);
  assert.equal(points.length, 3);
  assert.equal(comparisonValueAt(points, mainTimes[0]), 1900);
  assert.equal(comparisonValueAt(points, mainTimes[1]), 1902);
});

test("Compare preserves missing leading data and carries the prior value across lunch", () => {
  assert.deepEqual(alignComparisonPoints([{ time: 20, value: 5 }, { time: 30, value: 8 }], [10, 20, 25, 60]), [
    { time: 10 }, { time: 20, value: 5 }, { time: 25, value: 5 }, { time: 60, value: 8 },
  ]);
});

test("comparison ticks ahead of the main series never leak into earlier main bars", () => {
  const next = [...points, { time: mainTimes[1], value: 1903 }];
  assert.equal(comparisonValueAt(next, mainTimes[0]), 1900);
  assert.equal(comparisonValueAt(next, mainTimes[1]), 1903);
  next.at(-1).value = 1904;
  assert.equal(comparisonValueAt(next, mainTimes[1]), 1904);
  assert.deepEqual(alignComparisonPoints(next, [...mainTimes, mainTimes[1] + 60]).map((point) => point.time), [...mainTimes, mainTimes[1] + 60]);
});

const current = '[{"id":"retained"}]';
const day = "2026-10-07";
const normalize = (state) => state;
const stored = (values = {}) => JSON.stringify({ version: DRAWING_HISTORY_VERSION, day, undo: ["[]", current], redo: ['[{"id":"next"}]'], ...values });

test("same trading day reload preserves undo and redo", () => {
  assert.deepEqual(restoreDrawingHistory(stored(), current, day, normalize), JSON.parse(stored()));
});

test("a new exchange day retains drawings as a baseline with no previous-day undo or redo", () => {
  for (const history of [stored({ day: "2026-10-06" }), stored({ version: 1 }), null, "invalid", stored({ undo: ["[]"] })]) {
    assert.deepEqual(restoreDrawingHistory(history, current, day, normalize), {
      version: DRAWING_HISTORY_VERSION, day, undo: [current], redo: [],
    });
  }
});

test("the day boundary follows exchange midnight rather than UTC midnight", () => {
  assert.equal(drawingHistoryDay("Asia/Bangkok", new Date("2026-10-06T16:59:59Z")), "2026-10-06");
  assert.equal(drawingHistoryDay("Asia/Bangkok", new Date("2026-10-06T17:00:00Z")), "2026-10-07");
  assert.equal(drawingHistoryDay("UTC", new Date("2026-10-06T17:00:00Z")), "2026-10-06");
});
