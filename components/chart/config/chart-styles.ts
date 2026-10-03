import type { Bar } from "@/lib/dchart-api";

export const CHART_STYLES = [
  { id: 0, label: "Hình Thanh" },
  { id: 1, label: "Biểu đồ nến" },
  { id: 9, label: "Biểu đồ nến Hollow" },
  { id: 13, label: "Các cột" },
  { id: 2, label: "Đường thẳng" },
  { id: 14, label: "Biểu đồ Đường có điểm đánh dấu" },
  { id: 15, label: "Biểu đồ Đường bậc" },
  { id: 3, label: "Biểu đồ vùng" },
  { id: 16, label: "Vùng HLC" },
  { id: 10, label: "Đường cơ sở" },
  { id: 12, label: "Đỉnh-Đáy" },
  { id: 8, label: "Mô hình Heikin Ashi" },
] as const;
export type ChartStyle = typeof CHART_STYLES[number]["id"];
export const PRICE_SOURCES = ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"] as const;
export type PriceSource = typeof PRICE_SOURCES[number];
export const singleValueStyle = (style: ChartStyle) => [2, 14, 15, 3, 10, 13].includes(style);
export const candleStyle = (style: ChartStyle) => [1, 8, 9].includes(style);
export function isChartStyle(value: unknown): value is ChartStyle {
  return CHART_STYLES.some(({ id }) => id === value);
}

export interface ChartStyleSettings {
  source: PriceSource;
  upColor: string;
  downColor: string;
  borderUpColor: string;
  borderDownColor: string;
  wickUpColor: string;
  wickDownColor: string;
  bodyVisible: boolean;
  borderVisible: boolean;
  wickVisible: boolean;
  previousClose: boolean;
  thinBars: boolean;
  openVisible: boolean;
  color: string;
  lineWidth: number;
  lineStyle: number;
  fillTop: string;
  fillBottom: string;
  highColor: string;
  lowColor: string;
  highWidth: number;
  lowWidth: number;
  highStyle: number;
  lowStyle: number;
  highFill: string;
  lowFill: string;
  topFill2: string;
  bottomFill2: string;
  baselineColor: string;
  baseLevel: number;
  labelsVisible: boolean;
  labelColor: string;
  realPriceVisible: boolean;
}

export function defaultStyleSettings(style: ChartStyle): ChartStyleSettings {
  return {
    source: "close", upColor: style === 13 ? "rgba(8,153,129,0.5)" : "#089981",
    downColor: style === 13 ? "rgba(242,54,69,0.5)" : "#f23645",
    borderUpColor: "#089981", borderDownColor: "#f23645", wickUpColor: "#089981", wickDownColor: "#f23645",
    bodyVisible: true, borderVisible: true, wickVisible: true, previousClose: style === 13,
    thinBars: true, openVisible: true, color: style === 16 ? "#868993" : "#2962ff", lineWidth: 2, lineStyle: 0,
    fillTop: "rgba(41,98,255,0.28)", fillBottom: "rgba(41,98,255,0)",
    highColor: "#089981", lowColor: "#f23645", highWidth: 2, lowWidth: 2, highStyle: 0, lowStyle: 0,
    highFill: style === 10 ? "rgba(8,153,129,0.28)" : "rgba(8,153,129,0.2)", lowFill: style === 10 ? "rgba(242,54,69,0.28)" : "rgba(242,54,69,0.2)",
    topFill2: "rgba(8,153,129,0.05)", bottomFill2: "rgba(242,54,69,0.05)",
    baselineColor: "#758696", baseLevel: 50, labelsVisible: true, labelColor: "#2962ff", realPriceVisible: false,
  };
}

export type ChartStylePreferences = { style: ChartStyle; favorites: ChartStyle[]; settings: Partial<Record<ChartStyle, ChartStyleSettings>> };
const KEY = "chart.styles.v1";
export function readChartStylePreferences(): ChartStylePreferences {
  const defaults: ChartStylePreferences = { style: 1, favorites: [], settings: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!saved || typeof saved !== "object") return defaults;
    const settings: ChartStylePreferences["settings"] = {};
    for (const { id } of CHART_STYLES) {
      const values = saved.settings?.[id];
      if (!values || typeof values !== "object") continue;
      const initial = defaultStyleSettings(id);
      for (const key of Object.keys(initial) as (keyof ChartStyleSettings)[]) {
        const value = values[key];
        if (typeof value !== typeof initial[key]) continue;
        if (typeof value === "number" && (!Number.isFinite(value) || value < (key.endsWith("Width") ? 1 : 0) || value > (key === "baseLevel" ? 100 : key.endsWith("Style") ? 2 : 4) || key !== "baseLevel" && !Number.isInteger(value))) continue;
        if (key === "source" && !PRICE_SOURCES.includes(value)) continue;
        if (typeof value === "string" && key !== "source" && !CSS.supports("color", value)) continue;
        Object.assign(initial, { [key]: value });
      }
      settings[id] = initial;
    }
    return { style: isChartStyle(saved.style) ? saved.style : 1, favorites: Array.isArray(saved.favorites) ? [...new Set(saved.favorites.filter(isChartStyle))] as ChartStyle[] : [], settings };
  } catch { return defaults; }
}

export function saveChartStylePreferences(value: ChartStylePreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Bộ nhớ trình duyệt có thể bị vô hiệu hóa. */ }
}

export function sourceValue(bar: Bar, source: PriceSource): number {
  if (source === "hl2") return (bar.high + bar.low) / 2;
  if (source === "hlc3") return (bar.high + bar.low + bar.close) / 3;
  if (source === "ohlc4") return (bar.open + bar.high + bar.low + bar.close) / 4;
  return bar[source];
}

export function heikinAshi(bar: Bar, previous?: Bar): Bar {
  const close = (bar.open + bar.high + bar.low + bar.close) / 4;
  const open = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2;
  return { ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) };
}

export function chartStudyBars(bars: Bar[], style: ChartStyle): Bar[] {
  if (style !== 8) return bars;
  const values: Bar[] = [];
  for (const bar of bars) values.push(heikinAshi(bar, values.at(-1)));
  return values;
}
