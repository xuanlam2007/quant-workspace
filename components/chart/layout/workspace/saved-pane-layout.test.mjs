import assert from "node:assert/strict";
import test from "node:test";
import { occupiedPaneLayout } from "./saved-pane-layout.ts";

test("restoring removed indicators omits their panes and remaps surviving presentation", () => {
  const result = occupiedPaneLayout([0, 3, 3], { collapsed: [1, 3], maximized: 3, factors: [4, 1, 2, 3] });
  assert.deepEqual(result, { occupied: [0, 3], presentation: { collapsed: [1], maximized: 1, factors: [4, 3] } });
});

test("a removed maximized pane does not maximize another indicator", () => {
  const result = occupiedPaneLayout([2, 0], { collapsed: [1], maximized: 1, factors: [5, 1, 2] });
  assert.deepEqual(result, { occupied: [0, 2], presentation: { collapsed: [], maximized: null, factors: [5, 2] } });
});

test("shared sources retain one pane and its stretch factor", () => {
  const result = occupiedPaneLayout([0, 0, 0], { collapsed: [], maximized: null, factors: [4, 1] });
  assert.deepEqual(result, { occupied: [0], presentation: { collapsed: [], maximized: null, factors: [4] } });
});
