import assert from "node:assert/strict";
import test from "node:test";
import { independentStudyScale } from "./study-scale.ts";

test("volume and oscillators cannot share the candle scale after merge or restore", () => {
  for (const side of ["left", "right"]) {
    for (const id of ["volume", "macd", "rsi"]) {
      assert.equal(independentStudyScale(id, side, side, true), `study-scale:${id}`);
      assert.equal(independentStudyScale(id, side, side, false), side);
    }
  }
});

test("an independent visible axis is preserved", () => {
  assert.equal(independentStudyScale("volume", "left", "right", true), "left");
  assert.equal(independentStudyScale("volume", "volume", "right", true), "volume");
});
