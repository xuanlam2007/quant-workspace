import type { Bar } from "@/lib/dchart-api";

const TRADING_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const CHART_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function drawingStorageKey(symbol: string, resolution: string) {
  return `vndirect-chart:drawings:${symbol}:${resolution}`;
}

export function candleColor(bar: Bar) {
  return bar.close > bar.open ? "#53B987" : "#EB4D5C";
}

export function volumeColor(bar: Bar) {
  const isGrowing = bar.close >= bar.open;
  return isGrowing ? "rgba(83, 185, 135, 0.4)" : "rgba(235, 77, 92, 0.4)";
}

export function isTradingSessionTime(time: Bar["time"], resolution: string) {
  if (["D", "W", "M"].includes(resolution)) return true;

  const parts = TRADING_TIME_FORMATTER.formatToParts(new Date(Number(time) * 1000));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return false;

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  return (minutes >= 9 * 60 && minutes <= 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes <= 14 * 60 + 45);
}

export function formatVolume(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatChartTime(time: unknown) {
  const timestamp = Number(time);
  if (!Number.isFinite(timestamp)) return "";
  return CHART_TIME_FORMATTER.format(new Date(timestamp * 1000));
}

export function rangeForResolution(resolution: string, rangeDays?: number): { from: number; to: number } {
  const to = Math.floor(Date.now() / 1000);
  const daysBack = rangeDays ?? (resolution === "M" ? 3650 : resolution === "W" ? 1825 : resolution === "D" ? 730 : resolution === "60" ? 30 : 10);
  return { from: to - daysBack * 86400, to };
}

export function futureTimelinePoints(lastTime: number, resolution: string, count = 500) {
  const step = resolution === "M" ? 2592000 : resolution === "W" ? 604800 : resolution === "D" ? 86400 : Number(resolution) * 60;
  return Array.from({ length: count }, (_, index) => ({ time: (lastTime + step * (index + 1)) as Bar["time"] }));
}
