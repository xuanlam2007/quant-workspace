import assert from "node:assert/strict";
import test from "node:test";
import { fetchHistory } from "./dchart-api.ts";

function response(times, close = 10) {
  return new Response(JSON.stringify({
    s: "ok", t: times,
    o: times.map(() => 10), h: times.map(() => 20),
    l: times.map(() => 5), c: times.map(() => close),
    v: times.map(() => 100),
  }));
}

test("reuses navigation history while refreshing corrected and missing candles", async (t) => {
  let now = 1_000_000;
  const requests = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(new URL(url, "http://localhost").searchParams);
    return requests.length === 1 ? response([100, 160, 220]) : response([160, 220, 280], 12);
  });
  const initial = await fetchHistory("NAV_CACHE", "1", 100, 250);
  initial[0].close = 999;
  now += 10_000;
  const returned = await fetchHistory("NAV_CACHE", "1", 110, 290);
  assert.equal(requests[1].get("from"), "160");
  assert.deepEqual(returned.map((bar) => [bar.time, bar.close]), [[160, 12], [220, 12], [280, 12]]);
  const historical = await fetchHistory("NAV_CACHE", "1", 100, 150);
  assert.equal(historical[0].close, 10);
  assert.equal(requests.length, 2);
  now += 16 * 60_000;
  await fetchHistory("NAV_CACHE", "1", 100, 290);
  assert.equal(requests[2].get("from"), "100");
});

test("keeps symbols and resolutions separate and evicts least recently used ranges", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return response([100, 160, 220]); });
  await fetchHistory("ISOLATION", "1", 100, 250);
  await fetchHistory("ISOLATION", "5", 100, 250);
  assert.equal(calls, 2);
  for (let index = 0; index < 16; index += 1) {
    await fetchHistory(`EVICTION_${index}`, "1", 100, 250);
  }
  await fetchHistory("ISOLATION", "1", 100, 250);
  assert.equal(calls, 19);
});

test("does not cache failed or aborted requests, including aborted cache hits", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return response([100, 160]);
  });
  await assert.rejects(fetchHistory("FAILURE_CACHE", "1", 100, 200), /offline/);
  await fetchHistory("FAILURE_CACHE", "1", 100, 200);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchHistory("FAILURE_CACHE", "1", 100, 200, controller.signal), { name: "AbortError" });
  assert.equal(calls, 2);
});

test("refreshes empty ranges when their short freshness window expires", async (t) => {
  let now = 10_000;
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? new Response(JSON.stringify({ s: "no_data" })) : response([160]);
  });
  assert.deepEqual(await fetchHistory("EMPTY_CACHE", "1", 100, 200), []);
  now += 3_000;
  assert.equal((await fetchHistory("EMPTY_CACHE", "1", 100, 200)).length, 1);
  assert.equal(calls, 2);
});
