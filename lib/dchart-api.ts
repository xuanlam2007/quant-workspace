import type { UTCTimestamp } from "lightweight-charts";

const HISTORY_URL = "/api/dchart/history";
const SYMBOL_URL = "/api/dchart/symbols";
const CACHE_DURATION_MS = 2_000;

export interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawHistory {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  s: "ok" | "no_data" | "error";
}

interface RawSymbolInfo {
  name?: string;
  symbol?: string;
  description?: string;
  type?: string;
  timezone?: string;
  session?: string;
  minmov?: number;
  pricescale?: number;
  supported_resolutions?: string[];
  "exchange-traded"?: string;
  "exchange-listed"?: string;
}

export interface SymbolInfo {
  name: string;
  description: string;
  type: string;
  exchange: string;
  timezone: string;
  session: string;
  minMove: number;
  priceScale: number;
  supportedResolutions: string[];
}

const historyCache = new Map<string, { expiresAt: number; bars: Bar[] }>();
const unsupportedResolutions = new Set<string>();

class UnsupportedResolutionError extends Error {}

function aggregateDailyBars(bars: Bar[], resolution: "W" | "M"): Bar[] {
  const grouped = new Map<number, Bar>();
  const bucketSeconds = resolution === "W" ? 604800 : 2592000;

  for (const bar of bars) {
    const time = Math.floor(Number(bar.time) / bucketSeconds) * bucketSeconds;
    const current = grouped.get(time);
    if (!current) {
      grouped.set(time, { ...bar, time: time as UTCTimestamp });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  return [...grouped.values()];
}

function validateHistory(data: RawHistory) {
  const arrays = [data.t, data.o, data.h, data.l, data.c, data.v];
  if (!arrays.every(Array.isArray)) throw new Error("history response is malformed");
  if (!arrays.every((values) => values.length === data.t.length)) {
    throw new Error("history response arrays have different lengths");
  }
}

export function mergeBars(current: Bar[], incoming: Bar[]) {
  const bars = new Map<number, Bar>();
  incoming.forEach((bar) => bars.set(Number(bar.time), bar));
  current.forEach((bar) => bars.set(Number(bar.time), bar));
  return [...bars.values()].sort((left, right) => Number(left.time) - Number(right.time));
}

export async function fetchSymbolInfo(symbol: string, signal?: AbortSignal): Promise<SymbolInfo> {
  const params = new URLSearchParams({ symbol });
  const response = await fetch(`${SYMBOL_URL}?${params}`, { signal });
  if (!response.ok) throw new Error(`symbol fetch failed: ${response.status}`);
  const data = await response.json() as RawSymbolInfo;
  const priceScale = Number(data.pricescale);
  const minMove = Number(data.minmov);
  if (!data.name && !data.symbol) throw new Error("symbol response is malformed");
  if (!Number.isFinite(priceScale) || priceScale <= 0) throw new Error("symbol price scale is invalid");

  return {
    name: data.name ?? data.symbol ?? symbol,
    description: data.description ?? data.name ?? symbol,
    type: data.type ?? "",
    exchange: data["exchange-traded"] ?? data["exchange-listed"] ?? "",
    timezone: data.timezone ?? "Asia/Bangkok",
    session: data.session ?? "0900-1500",
    minMove: Number.isFinite(minMove) && minMove > 0 ? minMove : 1,
    priceScale,
    supportedResolutions: Array.isArray(data.supported_resolutions)
      ? data.supported_resolutions
      : [],
  };
}

export function symbolPriceFormat(info: SymbolInfo) {
  const minMove = info.minMove / info.priceScale;
  let precision = 0;
  let scaledMove = minMove;
  while (precision < 10 && Math.abs(scaledMove - Math.round(scaledMove)) > 1e-10) {
    scaledMove *= 10;
    precision += 1;
  }
  return { type: "price" as const, precision, minMove };
}

async function requestHistory(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    resolution,
    symbol,
    from: String(from),
    to: String(to),
  });
  const url = `${HISTORY_URL}?${params}`;
  const cached = historyCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.bars;
  if (cached) historyCache.delete(url);

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`history fetch failed: ${response.status}`);
  const body = await response.text();
  if (body.startsWith("Not support resolution")) {
    throw new UnsupportedResolutionError(body);
  }

  let data: RawHistory;
  try {
    data = JSON.parse(body) as RawHistory;
  } catch {
    throw new Error("history response is not valid JSON");
  }
  if (data.s === "error") throw new Error("history service returned error");
  if (data.s === "no_data") {
    const bars: Bar[] = [];
    historyCache.set(url, { expiresAt: Date.now() + CACHE_DURATION_MS, bars });
    return bars;
  }
  if (data.s !== "ok") throw new Error("history response has invalid status");
  validateHistory(data);

  const bars = data.t.map((time, index) => ({
    time: time as UTCTimestamp,
    open: data.o[index],
    high: data.h[index],
    low: data.l[index],
    close: data.c[index],
    volume: data.v[index],
  }));
  historyCache.set(url, { expiresAt: Date.now() + CACHE_DURATION_MS, bars });
  return bars;
}

export async function fetchHistory(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<Bar[]> {
  if (resolution !== "W" && resolution !== "M") {
    return requestHistory(symbol, resolution, from, to, signal);
  }

  if (!unsupportedResolutions.has(resolution)) {
    try {
      return await requestHistory(symbol, resolution, from, to, signal);
    } catch (error) {
      if (!(error instanceof UnsupportedResolutionError)) throw error;
      unsupportedResolutions.add(resolution);
    }
  }

  const dailyBars = await requestHistory(symbol, "D", from, to, signal);
  return aggregateDailyBars(dailyBars, resolution);
}
