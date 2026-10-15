import assert from "node:assert/strict";
import test from "node:test";
import { recoverBacktestAnalysis } from "./backtest-analysis.ts";

test("lost response recovers completed decision without another analysis or order", async () => {
  let requests = 0;
  let waits = 0;
  let cached;
  const decision = { action: "HOLD", reason: "Acknowledged setup" };
  const result = await recoverBacktestAnalysis(async () => { requests += 1; throw new TypeError("Failed to fetch"); }, () => cached, new AbortController().signal, async () => { waits += 1; cached = decision; });
  assert.equal(result, decision);
  assert.equal(requests, 1);
  assert.equal(waits, 1);
});

test("successful response does not start recovery", async () => {
  const result = await recoverBacktestAnalysis(async () => "completed", () => { throw new Error("Unexpected recovery"); }, new AbortController().signal);
  assert.equal(result, "completed");
});

test("provider rejection is never replaced by a cached decision", async () => {
  const rejection = new Error("Strategy changed");
  await assert.rejects(recoverBacktestAnalysis(async () => { throw rejection; }, () => "stale", new AbortController().signal), error => error === rejection);
});

test("cancelled analysis cannot recover or replay actions", async () => {
  const controller = new AbortController();
  const cancellation = new DOMException("Stopped", "AbortError");
  controller.abort(cancellation);
  await assert.rejects(recoverBacktestAnalysis(async () => { throw cancellation; }, () => "stale", controller.signal), error => error === cancellation);
});

test("missing result has bounded recovery and a useful connection error", async () => {
  let waits = 0;
  await assert.rejects(recoverBacktestAnalysis(async () => { throw new TypeError("Failed to fetch"); }, () => undefined, new AbortController().signal, async () => { waits += 1; }), /Mất kết nối/);
  assert.equal(waits, 20);
});

test("cancellation while recovering immediately discards the result", async () => {
  const controller = new AbortController();
  await assert.rejects(recoverBacktestAnalysis(async () => { throw new TypeError("Failed to fetch"); }, () => undefined, controller.signal, async () => { controller.abort(); }), { name: "AbortError" });
});
