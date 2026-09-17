import type { UTCTimestamp } from "lightweight-charts";

const HISTORY_URL = "https://api.example.com/history";

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

function aggregateDailyBars(bars: Bar[], resolution: "W" | "M"): Bar[] {
  const grouped = new Map<number, Bar>();

  for (const bar of bars) {
    const date = new Date(Number(bar.time) * 1000);
    const time = resolution === "W"
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7)) / 1000
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
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

/** Lấy một trang dữ liệu lịch sử để khởi tạo biểu đồ */
export async function fetchHistory(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<Bar[]> {
  // API chỉ cung cấp nến ngày, thư viện VNDIRECT tự tổng hợp tuần và tháng.
  const requestResolution = resolution === "W" || resolution === "M" ? "D" : resolution;
  const params = new URLSearchParams({
    resolution: requestResolution,
    symbol,
    from: String(from),
    to: String(to),
  });
  const res = await fetch(`${HISTORY_URL}?${params}`);
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
  const data: RawHistory = await res.json();
  if (data.s !== "ok" || !data.t?.length) return [];

  const bars = data.t.map((t, i) => ({
    time: t as UTCTimestamp,
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i],
  }));

  return resolution === "W" || resolution === "M"
    ? aggregateDailyBars(bars, resolution)
    : bars;
}
