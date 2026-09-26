import assert from "node:assert/strict";
import test from "node:test";
import {
  bundlePriceWheelRange,
  bundleTimeWheelRange,
  bundleWheelDelta,
  selectedZoomRange,
} from "./chart-zoom.ts";

test("normalizes VNDIRECT wheel deltas and suppresses the weaker axis", () => {
  const start = { totalX: 0, totalY: 0, lastTime: 0 };
  const vertical = bundleWheelDelta(1, 100, 0, 10, start);
  assert.equal(vertical.x, 0);
  assert.equal(vertical.y, 1);
  const lines = bundleWheelDelta(0, -1, 1, 200, vertical.state);
  assert.equal(lines.y, -0.32);
  assert.equal(lines.state.totalY, -1);
});

test("time wheel keeps the right edge unless a pointer anchor is requested", () => {
  const range = { from: 10, to: 110 };
  const rightAnchored = bundleTimeWheelRange(range, -1);
  assert.ok(rightAnchored);
  assert.equal(rightAnchored.to, 110);
  assert.ok(rightAnchored.from > 10);

  const pointerAnchored = bundleTimeWheelRange(range, -1, 0.25);
  assert.ok(pointerAnchored);
  const oldAnchor = range.from + 0.25 * (range.to - range.from);
  const newAnchor = pointerAnchored.from + 0.25 * (pointerAnchored.to - pointerAnchored.from);
  assert.ok(Math.abs(oldAnchor - newAnchor) < 1e-10);
});

test("price-axis wheel scales around the range center like the bundle", () => {
  const range = { from: 100, to: 200 };
  const atTop = bundlePriceWheelRange(range, 500, 0, 1);
  const atBottom = bundlePriceWheelRange(range, 500, 500, 1);
  assert.ok(atTop && atBottom);
  assert.equal((atTop.from + atTop.to) / 2, 150);
  assert.equal((atBottom.from + atBottom.to) / 2, 150);
  assert.ok(atTop.to - atTop.from > atBottom.to - atBottom.from);
});

test("rectangle zoom accepts either drag direction and rejects tiny selections", () => {
  assert.deepEqual(selectedZoomRange(40, 10, 1), { from: 10, to: 40 });
  assert.equal(selectedZoomRange(10.1, 10.9, 1), null);
  assert.equal(selectedZoomRange(Number.NaN, 20, 1), null);
});
