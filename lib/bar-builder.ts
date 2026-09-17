import type { UTCTimestamp } from "lightweight-charts";
import type { Bar } from "@/lib/dchart-api";

const RESOLUTION_SECONDS: Record<string, number> = {
  "1": 60,
  "5": 300,
  "15": 900,
  "30": 1800,
  "60": 3600,
  D: 86400,
  W: 604800,
  M: 2592000,
};

export function bucketStart(epochMs: number, resolution: string): UTCTimestamp {
  const t = Math.floor(epochMs >= 1e12 ? epochMs / 1000 : epochMs);
  if (resolution === "W" || resolution === "M") {
    const date = new Date(t * 1000);
    const day = resolution === "W"
      ? date.getUTCDate() - ((date.getUTCDay() + 6) % 7)
      : 1;
    return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day) / 1000) as UTCTimestamp;
  }

  const secs = RESOLUTION_SECONDS[resolution] ?? 60;
  return (Math.floor(t / secs) * secs) as UTCTimestamp;
}

/** Gộp tick trực tiếp vào nến hiện tại */
export function mergeTick(
  current: Bar | undefined,
  price: number,
  volume: number,
  bucket: UTCTimestamp
): Bar {
  if (!current || current.time !== bucket) {
    const open = current?.close ?? price;
    return {
      time: bucket,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume,
    };
  }

  return {
    ...current,
    high: Math.max(current.high, price),
    low: Math.min(current.low, price),
    close: price,
    volume: current.volume + volume,
  };
}
