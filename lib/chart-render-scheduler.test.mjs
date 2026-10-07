import assert from "node:assert/strict";
import test from "node:test";
import { createChartRenderScheduler } from "./chart-render-scheduler.ts";

function harness() {
  let visible = true;
  let nextId = 0;
  const frames = new Map();
  const renders = [];
  const scheduler = createChartRenderScheduler(
    () => visible, (rebuild) => renders.push(rebuild),
    (callback) => { frames.set(++nextId, callback); return nextId; },
    (id) => frames.delete(id),
  );
  return { scheduler, frames, renders, hide: () => { visible = false; }, show: () => { visible = true; } };
}

test("coalesces visible updates into one frame", () => {
  const h = harness();
  h.scheduler.schedule();
  h.scheduler.schedule();
  assert.equal(h.frames.size, 1);
  h.scheduler.flush();
  assert.deepEqual(h.renders, [false]);
  assert.equal(h.frames.size, 0);
});

test("retains dirty data without hidden rendering and catches up once", () => {
  const h = harness();
  h.scheduler.schedule();
  h.hide();
  h.scheduler.suspend();
  for (let index = 0; index < 100; index += 1) { h.scheduler.schedule(); h.scheduler.flush(); }
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.renders, []);
  h.show();
  h.scheduler.flush();
  h.scheduler.flush();
  assert.deepEqual(h.renders, [true]);
  h.scheduler.schedule();
  h.scheduler.flush();
  assert.deepEqual(h.renders, [true, false]);
});

test("does not render an unchanged workspace or a disposed scheduler", () => {
  const h = harness();
  h.hide(); h.scheduler.suspend(); h.show(); h.scheduler.flush();
  assert.deepEqual(h.renders, []);
  h.scheduler.schedule(); h.scheduler.dispose(); h.scheduler.flush(); h.scheduler.schedule();
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.renders, []);
});
