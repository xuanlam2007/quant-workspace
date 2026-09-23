import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARE_SYMBOLS_STORAGE_KEY,
  DEFAULT_SYMBOL,
  DEFAULT_RESOLUTION,
  RANGE_PRESETS,
  RESOLUTION_STORAGE_KEY,
  SYMBOL_STORAGE_KEY,
  RECENT_COMPARE_SYMBOLS_STORAGE_KEY,
  normalizeStoredCompareSymbols,
  normalizeStoredRecentCompareSymbols,
  normalizeStoredSymbol,
  normalizeStoredResolution,
} from "../components/chart/config/chart-config.ts";
import {
  candleColor,
  drawingStorageKey,
  formatChartTime,
  formatTimeInTimezone,
  formatVolume,
  futureTimelinePoints,
  getTimezoneOffsetString,
  isTradingSessionTime,
  millisecondsUntilNextSecond,
  rangeForResolution,
  volumeColor,
} from "../components/chart/core/chart-utils.ts";
import { TIMEZONE_OPTIONS, sortedTimezoneOptions } from "../components/chart/config/chart-timezones.ts";
import {
  bollingerData,
  calculateMa,
  macdData,
  priceIndicatorData,
  rsiData,
  volumeMa,
} from "../components/chart/indicators/chart-indicators.ts";
import {
  fetchHistory,
  fetchSymbolInfo,
  mergeBars,
  symbolPriceFormat,
} from "./dchart-api.ts";
import { connectionStatusLabel, normalizePriceTick } from "./dchart-socket.ts";
import { bucketStart } from "./bar-builder.ts";

const asEpochSeconds = (iso) => Date.parse(iso) / 1000;

test("maps footer presets to the VNDIRECT resolutions", () => {
  assert.deepEqual(
    RANGE_PRESETS.map(({ label, resolution }) => [label, resolution]),
    [
      ["5y", "W"],
      ["1y", "W"],
      ["3p", "D"],
      ["1p", "D"],
      ["5n", "5"],
      ["1n", "1"],
    ],
  );
});

test("restores only supported browser-stored resolutions", () => {
  assert.equal(DEFAULT_SYMBOL, "VN30");
  assert.equal(SYMBOL_STORAGE_KEY, "chart.lastUsedSymbol");
  assert.equal(COMPARE_SYMBOLS_STORAGE_KEY, "chart.comparedSymbols");
  assert.equal(RECENT_COMPARE_SYMBOLS_STORAGE_KEY, "chart.recentComparedSymbols");
  assert.equal(normalizeStoredSymbol("vnindex"), "VNINDEX");
  assert.equal(normalizeStoredSymbol(" VN30 "), "VN30");
  assert.equal(normalizeStoredSymbol(""), DEFAULT_SYMBOL);
  assert.equal(normalizeStoredSymbol("VN-30"), DEFAULT_SYMBOL);
  assert.deepEqual(
    normalizeStoredCompareSymbols('["vnd", "VND", "VN30", "VN-30"]', "VN30"),
    ["VND"],
  );
  assert.deepEqual(normalizeStoredCompareSymbols("not-json", "VN30"), []);
  assert.deepEqual(normalizeStoredRecentCompareSymbols('["vnd", "VND"]', "VN30"), ["VND"]);
  assert.equal(RESOLUTION_STORAGE_KEY, "chart.lastUsedTimeBasedResolution");
  assert.equal(normalizeStoredResolution("1"), "1");
  assert.equal(normalizeStoredResolution("W"), "W");
  assert.equal(normalizeStoredResolution("unsupported"), DEFAULT_RESOLUTION);
  assert.equal(normalizeStoredResolution(null), DEFAULT_RESOLUTION);
});

test("uses the resolved symbol session through the closing auction", () => {
  assert.equal(
    isTradingSessionTime(asEpochSeconds("2026-09-21T07:59:00.000Z"), "1", "0900-1500"),
    true,
  );
  assert.equal(
    isTradingSessionTime(asEpochSeconds("2026-09-21T08:01:00.000Z"), "1", "0900-1500"),
    false,
  );
  assert.equal(
    isTradingSessionTime(asEpochSeconds("2026-09-20T03:00:00.000Z"), "1", "0900-1500"),
    false,
  );
});

test("applies the configured volume average type and smoothing length", () => {
  const bars = [1, 3, 5, 7].map((volume, index) => ({
    time: index + 1,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume,
  }));

  assert.deepEqual(volumeMa(bars, 2, "SMA", 2), [
    { time: 3, value: 3 },
    { time: 4, value: 5 },
  ]);
});

test("normalizes symbol metadata into a chart price format", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      name: "VN30F2Q",
      symbol: "VN30F2Q",
      "exchange-traded": "HNX",
      "exchange-listed": "HNX",
      timezone: "Asia/Bangkok",
      minmov: 5,
      pricescale: 10,
      session: "0900-1500",
      supported_resolutions: ["1", "5", "D"],
    }));
  };

  try {
    const info = await fetchSymbolInfo("VN30F2Q");
    assert.equal(info.exchange, "HNX");
    assert.equal(info.session, "0900-1500");
    assert.equal(requestedUrl, "/api/dchart/symbols?symbol=VN30F2Q");
    assert.deepEqual(symbolPriceFormat(info), {
      type: "price",
      precision: 1,
      minMove: 0.5,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws when the history service reports an error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ s: "error" }));

  try {
    await assert.rejects(
      fetchHistory("VN30", "1", 100, 200),
      /history service returned error/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("caches identical successful history requests for two seconds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    calls += 1;
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      s: "ok",
      t: [100],
      o: [10],
      h: [12],
      l: [9],
      c: [11],
      v: [1000],
    }));
  };

  try {
    await fetchHistory("CACHE_TEST", "1", 100, 200);
    await fetchHistory("CACHE_TEST", "1", 100, 200);
    assert.equal(calls, 1);
    assert.equal(
      requestedUrl,
      "/api/dchart/history?resolution=1&symbol=CACHE_TEST&from=100&to=200",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merges backfilled bars in chronological order without duplicates", () => {
  const current = [
    { time: 200, open: 2, high: 3, low: 1, close: 2, volume: 20 },
    { time: 300, open: 3, high: 4, low: 2, close: 3, volume: 30 },
  ];
  const older = [
    { time: 100, open: 1, high: 2, low: 0, close: 1, volume: 10 },
    { time: 200, open: 20, high: 30, low: 10, close: 20, volume: 200 },
  ];

  assert.deepEqual(mergeBars(current, older).map((bar) => [bar.time, bar.close]), [
    [100, 1],
    [200, 2],
    [300, 3],
  ]);
});

test("normalizes VNDIRECT socket ticks and rejects invalid payloads", () => {
  assert.deepEqual(normalizePriceTick({
    symbol: "VN30",
    price: "1942.12",
    volume: "25",
    time: 1_789_948_800,
  }), {
    symbol: "VN30",
    price: 1942.12,
    volume: 25,
    time: 1_789_948_800_000,
  });
  assert.equal(normalizePriceTick({ symbol: "VN30", price: "invalid" }), undefined);
});

test("describes every VNDIRECT connection state", () => {
  assert.equal(connectionStatusLabel("connected"), "Đã kết nối VNDIRECT");
  assert.equal(connectionStatusLabel("reconnecting"), "Đang kết nối VNDIRECT");
  assert.equal(connectionStatusLabel("disconnected"), "Mất kết nối VNDIRECT");
});

test("uses the bundle epoch buckets for weekly and monthly realtime bars", () => {
  const timestamp = asEpochSeconds("2026-09-21T10:33:00.000Z");
  assert.equal(bucketStart(timestamp, "W"), Math.floor(timestamp / 604800) * 604800);
  assert.equal(bucketStart(timestamp, "M"), Math.floor(timestamp / 2592000) * 2592000);
});

test("calculates the supported moving-average and study variants", () => {
  const points = [1, 2, 3, 4].map((value) => ({ time: value, value }));
  assert.deepEqual(calculateMa(points, 2, "SMA").map((point) => point.value), [1.5, 2.5, 3.5]);
  assert.deepEqual(calculateMa(points, 2, "WMA").map((point) => point.value), [5 / 3, 8 / 3, 11 / 3]);
  assert.deepEqual(calculateMa(points, 2, "EMA").map((point) => point.value), [1.5, 2.5, 3.5]);

  const bars = Array.from({ length: 40 }, (_, index) => ({
    time: index + 1,
    open: index + 1,
    high: index + 2,
    low: index,
    close: index + 1,
    volume: (index + 1) * 100,
  }));
  assert.equal(priceIndicatorData(bars, 20, "SMA").length, 21);
  assert.equal(bollingerData(bars, "middle").length, 21);
  assert.equal(bollingerData(bars, "upper")[0].value > bollingerData(bars, "lower")[0].value, true);
  assert.equal(macdData(bars).histogram.length > 0, true);
  assert.equal(rsiData(bars).every((point) => point.value === 100), true);
});

test("formats chart values and builds deterministic timeline ranges", () => {
  const rising = { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1_250_000 };
  const falling = { ...rising, close: 9 };
  assert.equal(candleColor(rising), "#54BA88");
  assert.equal(candleColor(falling), "#EB4D5C");
  assert.equal(volumeColor(rising), "rgba(83, 185, 135, 0.4)");
  assert.equal(volumeColor(falling), "rgba(235, 77, 92, 0.4)");
  assert.equal(formatVolume(rising.volume), "1.25M");
  assert.equal(formatVolume(1_250), "1.3K");
  assert.equal(formatVolume(25), "25");
  assert.equal(formatChartTime("invalid"), "");
  assert.equal(formatChartTime(0).length > 0, true);
  assert.equal(drawingStorageKey("VN30", "1"), "vndirect-chart:drawings:VN30:1");

  const dailyRange = rangeForResolution("D");
  assert.equal(dailyRange.to - dailyRange.from, 730 * 86400);
  assert.deepEqual(futureTimelinePoints(100, "5", 2).map((point) => point.time), [400, 700]);
  assert.deepEqual(futureTimelinePoints(100, "W", 1).map((point) => point.time), [604900]);
  assert.equal(getTimezoneOffsetString("Asia/Bangkok").string, "UTC+7");
  assert.equal(getTimezoneOffsetString("Etc/UTC").string, "UTC");
  assert.match(formatTimeInTimezone(new Date(), "Asia/Bangkok"), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(millisecondsUntilNextSecond(1_234), 766);
  assert.equal(millisecondsUntilNextSecond(2_000), 1_000);
});

test("provides the VNDIRECT timezone catalog in offset order", () => {
  assert.equal(TIMEZONE_OPTIONS.length > 60, true);
  assert.equal(TIMEZONE_OPTIONS.some(({ id }) => id === "Pacific/Honolulu"), true);
  assert.equal(TIMEZONE_OPTIONS.some(({ id }) => id === "Atlantic/Reykjavik"), true);
  const sorted = sortedTimezoneOptions(new Date("2026-09-23T00:00:00.000Z"));
  assert.equal(sorted[0].id, "Etc/UTC");
  assert.equal(sorted[1].id, "exchange");
  assert.equal(sorted[2].id, "Pacific/Honolulu");
});

test("falls back to daily bars when weekly history is unsupported", async () => {
  const originalFetch = globalThis.fetch;
  const requestedResolutions = [];
  globalThis.fetch = async (url) => {
    const resolution = new URL(String(url), "http://localhost").searchParams.get("resolution");
    requestedResolutions.push(resolution);
    if (resolution === "W") return new Response("Not support resolution W");
    return new Response(JSON.stringify({
      s: "ok",
      t: [604800, 691200],
      o: [10, 11],
      h: [12, 14],
      l: [9, 8],
      c: [11, 13],
      v: [100, 200],
    }));
  };

  try {
    const bars = await fetchHistory("WEEKLY_TEST", "W", 1, 800000);
    assert.deepEqual(requestedResolutions, ["W", "D"]);
    assert.deepEqual(bars, [{
      time: 604800,
      open: 10,
      high: 14,
      low: 8,
      close: 13,
      volume: 300,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
