import assert from "node:assert/strict";
import test from "node:test";
import { occupiedPaneLayout, restoredSourcePanes } from "./saved-pane-layout.ts";

test("new volume and oscillator panes survive a main-only saved layout", () => {
  const panes = restoredSourcePanes([{ id: "main", pane: 0 }, { id: "volume", pane: 1 }, { id: "volume:ma", pane: 1 }, { id: "rsi", pane: 2 }], [{ id: "main", pane: 0 }], 1);
  assert.deepEqual([...panes.values()], [0, 2, 2, 3]);
  assert.deepEqual(occupiedPaneLayout([...panes.values()], { collapsed: [], maximized: null, factors: [4] }).presentation.factors, [4, 1, 1]);
});

test("new price overlays follow the restored price pane and explicit anchors", () => {
  const panes = restoredSourcePanes([{ id: "main", pane: 0 }, { id: "ma", pane: 0 }, { id: "volume", pane: 1, anchor: "main" }], [{ id: "main", pane: 2 }, { id: "volume", pane: 1 }], 3);
  assert.deepEqual([...panes.values()], [2, 2, 2]);
});

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
