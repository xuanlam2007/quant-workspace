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

/** Lấy một trang dữ liệu lịch sử để khởi tạo biểu đồ */
export async function fetchHistory(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<Bar[]> {
  const params = new URLSearchParams({
    resolution,
    symbol,
    from: String(from),
    to: String(to),
  });
  const res = await fetch(`${HISTORY_URL}?${params}`);
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
  const data: RawHistory = await res.json();
  if (data.s !== "ok" || !data.t?.length) return [];

  return data.t.map((t, i) => ({
    time: t as UTCTimestamp,
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i],
  }));
}
