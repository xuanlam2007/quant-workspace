import assert from "node:assert/strict";
import test from "node:test";
import { ReplayToolDelivery, waitForReplayPaint, pollReplayTools } from "./backtest-tool-delivery.ts";

test("tool polling starts immediately and continues without browser timer callbacks", async () => {
  let count = 0;
  let pending = 0;
  const waiting = pollReplayTools(() => count < 8, async () => {
    assert.equal(pending++, 0);
    count++;
    await Promise.resolve();
    pending--;
    return true;
  }, async () => { throw new Error("Successful polling must not wait for a timer"); });
  assert.equal(count, 1);
  await waiting;
  assert.equal(count, 8);
});

test("failed or skipped polls back off and cancellation prevents another request", async () => {
  let count = 0;
  let retries = 0;
  let active = true;
  await pollReplayTools(() => active, async () => { count++; return false; }, async () => { retries++; active = false; });
  assert.equal(count, 1);
  assert.equal(retries, 1);
});

test("stopping during an in-flight poll does not schedule another poll", async () => {
  let active = true;
  let count = 0;
  await pollReplayTools(() => active, async () => { count++; active = false; return false; }, async () => { throw new Error("Unexpected retry"); });
  assert.equal(count, 1);
});

test("lost ACK is redelivered without repeating chart changes or simulated orders", async () => {
  let orders = 0;
  let confirmations = 0;
  const sent = [];
  const delivery = new ReplayToolDelivery(() => { confirmations += 1; });
  const prepare = async () => { orders += 1; return { command_id: "order", frame: { cutoff: 60 } }; };
  await assert.rejects(delivery.deliver("order", prepare, async payload => { sent.push(payload); throw new TypeError("Failed to fetch"); }));
  await delivery.deliver("order", prepare, async payload => { sent.push(payload); });
  await delivery.deliver("order", prepare, async () => { throw new Error("Unexpected redelivery"); });
  assert.equal(orders, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.equal(confirmations, 1);
});

test("sync confirmation recovers an ACK whose successful response was lost", async () => {
  let applications = 0;
  const confirmations = [];
  const delivery = new ReplayToolDelivery(payload => confirmations.push(payload));
  const prepare = async () => { applications += 1; return { command_id: "chart", cutoff: 60 }; };
  await assert.rejects(delivery.deliver("chart", prepare, async () => { throw new TypeError("Response lost after acceptance"); }));
  await delivery.confirm(["unknown", "chart", "chart"]);
  await delivery.deliver("chart", prepare, async () => { throw new Error("Unexpected redelivery"); });
  assert.equal(applications, 1);
  assert.equal(confirmations.length, 1);
});

test("failed preparation is never rerun during polling", async () => {
  let attempts = 0;
  const delivery = new ReplayToolDelivery(() => { throw new Error("Unexpected confirmation"); });
  const prepare = async () => { attempts += 1; throw new Error("Replay changed"); };
  for (let index = 0; index < 3; index += 1) await assert.rejects(delivery.deliver("chart", prepare, async () => { throw new Error("Unexpected ACK"); }), /Replay changed/);
  assert.equal(attempts, 1);
});

test("consecutive chart commands survive alternating ACK request and response loss", async () => {
  const changes = new Map();
  const confirmed = [];
  const delivery = new ReplayToolDelivery(payload => confirmed.push(payload.id));
  for (let index = 0; index < 12; index += 1) {
    const id = String(index);
    const prepare = async () => { changes.set(id, (changes.get(id) || 0) + 1); return { id, cutoff: 60 * (index + 1) }; };
    await assert.rejects(delivery.deliver(id, prepare, async () => { throw new TypeError("Connection lost"); }));
    if (index % 2) await delivery.confirm([id]);
    await delivery.deliver(id, prepare, async () => {});
  }
  assert.equal(confirmed.length, 12);
  assert.equal(new Set(confirmed).size, 12);
  assert.ok([...changes.values()].every(count => count === 1));
});

test("paint wait completes when background tabs stop delivering animation frames", { timeout: 1000 }, async () => {
  const cancelled = [];
  await waitForReplayPaint(() => 42, id => cancelled.push(id));
  assert.ok(cancelled.includes(42));
});

test("normal paint wait finishes after two frames and cancels its fallback", async () => {
  const frames = [];
  const cancelled = [];
  const waiting = waitForReplayPaint(callback => { frames.push(callback); return frames.length; }, id => cancelled.push(id));
  frames[0](0);
  frames[1](16);
  await waiting;
  assert.deepEqual(cancelled, [1, 2]);
});
