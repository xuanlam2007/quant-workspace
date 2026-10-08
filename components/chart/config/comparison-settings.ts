import type { Bar, SymbolInfo } from "@/lib/dchart-api";
import type { ReferenceDefinition, ReferencePoint, ReferenceSettings } from "@/lib/reference-studies";
import { referenceDefaults } from "@/lib/reference-studies";
import { sourceValue, type PriceSource } from "./chart-styles";

export const COMPARISON_PLOTS = [[0, "Đường thẳng"], [7, "Các đường gãy"], [9, "Biểu đồ Đường bậc"], [11, "Đường bậc ngắt quãng"], [10, "Bước đường có hình thoi"], [1, "Biểu đồ tần suất"], [3, "Chéo nhau"], [4, "Biểu đồ vùng"], [8, "Vùng gãy"], [5, "Các cột"], [6, "Các vòng tròn"]] as const;
export const COMPARISON_SOURCES: readonly [PriceSource, string][] = [["open", "Mở"], ["high", "Cao"], ["low", "Thấp"], ["close", "Đóng"], ["hl2", "(Cao + Thấp) / 2"], ["hlc3", "(Cao + Thấp + Đóng) / 3"], ["ohlc4", "(Mở + Cao + Thấp + Đóng) / 4"]];
export const COMPARISON_INTERVALS = [["Phút", 59], ["Giờ", 24], ["Ngày", 366], ["Tuần", 52], ["Tháng", 12]] as const;

// Cấu hình Compare và công thức nguồn giá được chuyển từ bundle VNDIRECT.
export const COMPARISON_DEFINITION: ReferenceDefinition = {
  name: "Compare", constructor: class {},
  metainfo: {
    id: "Compare@tv-basicstudies-1", description: "Compare", shortDescription: "Compare", is_price_study: true,
    inputs: [], plots: [{ id: "compare", type: "line" }], styles: { compare: { title: "Plot", histogramBase: 0 } },
    defaults: { styles: { compare: { linestyle: 0, linewidth: 2, plottype: 0, trackPrice: false, transparency: 0, visible: true, color: "#9C27B0" } } },
    format: { type: "inherit" },
  },
};

export interface ComparisonSettings {
  source: PriceSource;
  plot: number;
  color: string;
  width: number;
  lineStyle: number;
  priceLine: boolean;
  minTick: number | null;
  intervals: { enabled: boolean; from: number; to: number }[];
}

export function comparisonDefaults(color = "#9C27B0"): ComparisonSettings {
  return { source: "close", plot: 0, color, width: 2, lineStyle: 0, priceLine: false, minTick: null, intervals: COMPARISON_INTERVALS.map(([, to]) => ({ enabled: true, from: 1, to })) };
}

export function normalizeComparisonSettings(value: unknown, color = "#9C27B0"): ComparisonSettings {
  const defaults = comparisonDefaults(color);
  if (!value || typeof value !== "object") return defaults;
  const saved = value as Partial<ComparisonSettings>;
  const bounded = (value: unknown, fallback: number, maximum: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.round(value))) : fallback;
  return {
    source: COMPARISON_SOURCES.some(([source]) => source === saved.source) ? saved.source! : defaults.source,
    plot: COMPARISON_PLOTS.some(([plot]) => plot === saved.plot) ? saved.plot! : defaults.plot,
    color: typeof saved.color === "string" && /^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(saved.color) ? saved.color : defaults.color,
    width: bounded(saved.width, defaults.width, 4),
    lineStyle: typeof saved.lineStyle === "number" && [0, 1, 2, 3, 4].includes(saved.lineStyle) ? saved.lineStyle : defaults.lineStyle,
    priceLine: saved.priceLine === true,
    minTick: typeof saved.minTick === "number" && Number.isFinite(saved.minTick) && saved.minTick > 0 ? saved.minTick : null,
    intervals: COMPARISON_INTERVALS.map(([, maximum], index) => {
      const range = Array.isArray(saved.intervals) ? saved.intervals[index] : undefined;
      const from = bounded(range?.from, 1, maximum);
      return { enabled: range?.enabled !== false, from, to: Math.max(from, bounded(range?.to, maximum, maximum)) };
    }),
  };
}

export function comparisonReferenceSettings(settings: ComparisonSettings): ReferenceSettings {
  const result = referenceDefaults(COMPARISON_DEFINITION);
  result.styles.compare = { ...result.styles.compare, color: settings.color, linewidth: settings.width, linestyle: settings.lineStyle, plottype: settings.plot, trackPrice: settings.priceLine };
  return result;
}

export function comparisonAllowed(settings: ComparisonSettings, resolution: string) {
  const group = /M$/.test(resolution) ? 4 : /W$/.test(resolution) ? 3 : /D$/.test(resolution) ? 2 : Number(resolution) >= 60 ? 1 : 0;
  const multiplier = group === 1 ? Math.floor(Number(resolution) / 60) : Number(resolution.replace(/[DWM]$/, "")) || 1;
  const interval = settings.intervals[group];
  return interval.enabled && multiplier >= interval.from && multiplier <= interval.to;
}

export function comparisonPoints(bars: Bar[], settings: ComparisonSettings) {
  return bars.map(bar => ({ time: bar.time, value: sourceValue(bar, settings.source) }));
}

export function comparisonPlotPoint(point: { time: Bar["time"]; value?: number }): ReferencePoint {
  const value = point.value ?? NaN;
  return { time: point.time, values: { compare: value }, colors: {}, high: value, low: value };
}

export function comparisonPriceFormat(settings: ComparisonSettings, info?: SymbolInfo) {
  const move = settings.minTick ?? (info ? info.minMove / info.priceScale : .01);
  const minMove = Number.isFinite(move) && move > 0 ? move : .01;
  const precision = minMove.toFixed(8).replace(/0+$/, "").split(".")[1]?.length ?? 0;
  return { type: "price" as const, minMove, precision };
}
