import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { marketDataConfig } from "./market-data-config.ts";
import { SAMPLE_BAR_LIMIT, sampleHistory, samplePrice, sampleSymbol, sampleTick } from "./sample-market-data.ts";
import { isTradingSessionTime } from "../components/chart/core/chart-utils.ts";

test("unconfigured and example endpoints select sample data; incomplete live settings fail", () => {
  assert.deepEqual(marketDataConfig({}), { mode: "sample", name: "Sample data" });
  assert.equal(marketDataConfig({ MARKET_DATA_API_URL: "https://api.example.com", MARKET_DATA_SOCKET_URL: "https://socket.example.com/" }).mode, "sample");
  assert.throws(() => marketDataConfig({ MARKET_DATA_API_URL: "https://feed.invalid" }));
  assert.throws(() => marketDataConfig({ MARKET_DATA_API_URL: "invalid" }));
  assert.throws(() => marketDataConfig({ MARKET_DATA_API_URL: "https://user:secret@feed.invalid", MARKET_DATA_SOCKET_URL: "https://feed.invalid" }));
  assert.deepEqual(marketDataConfig({ MARKET_DATA_API_URL: "https://feed.invalid/", MARKET_DATA_SOCKET_URL: "https://feed.invalid", MARKET_DATA_PROVIDER_NAME: "My feed" }), {
    mode: "live", apiUrl: "https://feed.invalid", socketUrl: "https://feed.invalid", name: "My feed",
  });
});

test("sample bars are bounded, sorted, deterministic and agree with the latest tick", () => {
  const now = Date.parse("2026-10-10T06:12:34Z");
  const to = now / 1000 + 600;
  const history = sampleHistory("VN30F1M", "1", to - 3600, to, now);
  assert.equal(history.s, "ok");
  assert.deepEqual(history, sampleHistory("VN30F1M", "1", to - 3600, to, now));
  assert.equal(history.c.at(-1), sampleTick("VN30F1M", now).price);
  assert.notEqual(samplePrice("VN30", now / 1000), samplePrice("VN30F1M", now / 1000));
  for (let i = 0; i < history.t.length; i++) {
    assert.ok(history.t[i] <= now / 1000);
    assert.ok(history.h[i] >= Math.max(history.o[i], history.c[i]));
    assert.ok(history.l[i] <= Math.min(history.o[i], history.c[i]));
    assert.ok(history.v[i] > 0);
    if (i) assert.equal(history.t[i] - history.t[i - 1], 60);
  }
  assert.equal(sampleHistory("VN30", "1", 1, to, now).t.length, SAMPLE_BAR_LIMIT);
  assert.equal(sampleHistory("VN30", "1", to, to + 60, now).s, "no_data");
  assert.throws(() => sampleHistory("VN30", "invalid", 1, to, now));
});

test("sample symbols identify synthetic prices and permit weekend ticks", () => {
  const info = sampleSymbol("VN30");
  assert.equal(info.type, "sample");
  assert.match(info.description, /Sample data/);
  const weekend = Date.parse("2026-10-10T06:12:34Z") / 1000;
  assert.equal(isTradingSessionTime(weekend, "1", info.session), true);
  assert.equal(isTradingSessionTime(weekend, "1", "0900-1500"), false);
  for (const resolution of info.supported_resolutions) {
    const history = sampleHistory("VN30", resolution, weekend - 86400 * 90, weekend, weekend * 1000);
    assert.equal(history.s, "ok");
  }
});

test("status observers do not initialize a feed; sample subscriptions share ticks and stop on close", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: Date.parse("2026-10-10T06:12:34Z") });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ mode: "sample", name: "Sample data" }));
  const feed = await import(`./dchart-socket.ts?sample=${Date.now()}`);
  const unobserve = feed.subscribeConnectionStatus(() => {});
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(feed.getConnectionStatus(), "idle");
  const ticks = []; const comparisonTicks = [];
  const first = feed.connectPriceFeed("VN30", (tick) => ticks.push(tick), () => {});
  const second = feed.connectPriceFeed("VN30", (tick) => comparisonTicks.push(tick), () => {});
  await settle();
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(feed.getPriceFeedName(), "Sample data");
  t.mock.timers.tick(1000);
  assert.equal(ticks.length, 1);
  assert.deepEqual(ticks, comparisonTicks);
  second.changeSymbol("VN30F1M");
  t.mock.timers.tick(1000);
  assert.equal(comparisonTicks.at(-1).symbol, "VN30F1M");
  first.close(); second.close(); unobserve();
  assert.equal(feed.getConnectionStatus(), "idle");
  t.mock.timers.tick(1000);
  assert.equal(ticks.length, 2);
});

test("provider configuration failures never emit sample ticks and retry only while subscribed", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "unavailable" }, { status: 503 }));
  const feed = await import("./dchart-socket.ts?failed-config");
  const ticks = [];
  const subscription = feed.connectPriceFeed("VN30", (tick) => ticks.push(tick), () => {});
  await settle();
  assert.equal(feed.getConnectionStatus(), "disconnected");
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(ticks.length, 0);
  subscription.close();
  t.mock.timers.tick(20_000);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("closing before provider discovery finishes does not start a sample timer", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let resolve;
  t.mock.method(globalThis, "fetch", () => new Promise((done) => { resolve = done; }));
  const feed = await import("./dchart-socket.ts?cancelled-config");
  const ticks = [];
  const subscription = feed.connectPriceFeed("VN30", (tick) => ticks.push(tick), () => {});
  subscription.close();
  resolve(Response.json({ mode: "sample", name: "Sample data" }));
  await settle();
  t.mock.timers.tick(1000);
  assert.equal(feed.getConnectionStatus(), "idle");
  assert.equal(ticks.length, 0);
});
