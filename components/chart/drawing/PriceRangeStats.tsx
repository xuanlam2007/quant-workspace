import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { LineToolExport, LineToolType } from "lightweight-charts-line-tools-core";
import type { Bar } from "@/lib/dchart-api";

interface PriceRangeStatsProps {
  drawing: LineToolExport<LineToolType>;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  chartTop: number;
  bars: Bar[];
  viewportVersion: number;
}

function compactVolume(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(3)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function PriceRangeStats({ drawing, chart, series, chartTop, bars, viewportVersion }: PriceRangeStatsProps) {
  void viewportVersion;
  if (drawing.toolType !== "PriceRange" || drawing.points.length < 2) return null;

  const [start, end] = drawing.points;
  const x = chart.timeScale().timeToCoordinate(end.timestamp as Time);
  const y = series.priceToCoordinate(end.price);
  if (x === null || y === null) return null;

  const difference = end.price - start.price;
  const percentage = start.price === 0 ? 0 : (difference / start.price) * 100;
  const ticks = Math.round(difference / 0.01);
  const startIndex = bars.findIndex((bar) => Number(bar.time) === Number(start.timestamp));
  const endIndex = bars.findIndex((bar) => Number(bar.time) === Number(end.timestamp));
  const barCount = startIndex >= 0 && endIndex >= 0 ? Math.abs(endIndex - startIndex) : 0;
  const durationMinutes = Math.round(Math.abs(Number(end.timestamp) - Number(start.timestamp)) / 60);
  const from = Math.min(Number(start.timestamp), Number(end.timestamp));
  const to = Math.max(Number(start.timestamp), Number(end.timestamp));
  const volume = bars.reduce((total, bar) => {
    const time = Number(bar.time);
    return time >= from && time <= to ? total + bar.volume : total;
  }, 0);
  const sign = difference >= 0 ? "+" : "";
  const color = difference >= 0 ? "#53b987" : "#eb4d5c";

  return (
    <div
      className="price-range-stats"
      style={{ left: x, top: chartTop + y + 12, background: color }}
      aria-label={`Biên độ giá ${difference.toFixed(2)}, ${percentage.toFixed(2)} phần trăm`}
    >
      <strong>{sign}{difference.toFixed(2)} ({sign}{percentage.toFixed(2)}%), {sign}{ticks}</strong>
      <span>{sign}{barCount} thanh, {sign}{durationMinutes}p</span>
      <span>Khối lượng {compactVolume(volume)}</span>
    </div>
  );
}
