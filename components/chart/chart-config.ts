import type { LineToolType } from "lightweight-charts-line-tools-core";

export type MaType = "SMA" | "EMA" | "WMA";
export type StudyId = "volume" | "ma" | "ema" | "macd" | "rsi" | "boll";
export type ScaleMode = "normal" | "percent" | "log";

export const SYMBOLS = ["VN30", "VNINDEX"];

export const RESOLUTIONS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" },
  { value: "M", label: "1M" },
];

export const TIMEFRAME_GROUPS = [
  { label: "PHÚT", options: [{ value: "1", label: "1 phút" }, { value: "5", label: "5 phút" }, { value: "15", label: "15 phút" }, { value: "30", label: "30 phút" }] },
  { label: "GIỜ", options: [{ value: "60", label: "1 giờ" }] },
  { label: "NGÀY", options: [{ value: "D", label: "1 ngày" }, { value: "W", label: "1 tuần" }, { value: "M", label: "1 tháng" }] },
];

export const RANGE_PRESETS = [
  { label: "5y", days: 365 * 5 },
  { label: "1y", days: 365 },
  { label: "3p", days: 90 },
  { label: "1p", days: 30 },
  { label: "5n", days: 5 },
  { label: "1n", days: 1 },
];

export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DrawingIcon =
  | "trend" | "arrow" | "ray" | "extended" | "horizontal" | "horizontalRay"
  | "vertical" | "cross" | "fib" | "rectangle" | "text" | "callout"
  | "priceRange" | "position";

export interface DrawingToolOption {
  type: LineToolType;
  icon: DrawingIcon;
  title: string;
}

export interface DrawingToolGroup {
  id: string;
  icon: DrawingIcon;
  title: string;
  tools: DrawingToolOption[];
}

export const DRAWING_TOOL_GROUPS: DrawingToolGroup[] = [
  {
    id: "lines",
    icon: "trend",
    title: "Đường xu hướng",
    tools: [
      { type: "TrendLine", icon: "trend", title: "Đường xu hướng" },
      { type: "Arrow", icon: "arrow", title: "Mũi tên" },
      { type: "Ray", icon: "ray", title: "Tia" },
      { type: "ExtendedLine", icon: "extended", title: "Đường kéo dài" },
      { type: "HorizontalLine", icon: "horizontal", title: "Đường ngang" },
      { type: "HorizontalRay", icon: "horizontalRay", title: "Tia ngang" },
      { type: "VerticalLine", icon: "vertical", title: "Đường dọc" },
      { type: "CrossLine", icon: "cross", title: "Đường chữ thập" },
    ],
  },
  {
    id: "fibonacci",
    icon: "fib",
    title: "Gann và Fibonacci",
    tools: [
      { type: "FibRetracement", icon: "fib", title: "Fibonacci thoái lui" },
    ],
  },
  {
    id: "geometry",
    icon: "rectangle",
    title: "Hình học",
    tools: [
      { type: "Rectangle", icon: "rectangle", title: "Hình chữ nhật" },
    ],
  },
  {
    id: "annotations",
    icon: "text",
    title: "Chú thích",
    tools: [
      { type: "Text", icon: "text", title: "Văn bản" },
      { type: "Callout", icon: "callout", title: "Chú thích có đường dẫn" },
    ],
  },
  {
    id: "measurement",
    icon: "position",
    title: "Dự báo và đo lường",
    tools: [
      { type: "LongShortPosition", icon: "position", title: "Vị thế mua hoặc bán" },
      { type: "PriceRange", icon: "priceRange", title: "Biên độ giá" },
    ],
  },
];

export const STUDY_CATALOG: Array<{ id: StudyId; label: string; description: string; color: string }> = [
  { id: "volume", label: "Khối lượng", description: "20 SMA 9", color: "#1f6fd1" },
  { id: "ma", label: "Moving Average", description: "MA 20, 50", color: "#f7941d" },
  { id: "ema", label: "Moving Average Exponential", description: "EMA 10, 50, 200", color: "#49bee3" },
  { id: "macd", label: "MACD", description: "12, 26, 9", color: "#2962ff" },
  { id: "rsi", label: "Relative Strength Index", description: "RSI 14", color: "#7e57c2" },
  { id: "boll", label: "Bollinger Bands", description: "20, 2", color: "#ff6d00" },
];

export const PRICE_INDICATORS = [
  { id: "MA20", study: "ma" as const, length: 20, type: "SMA" as const, color: "#f7941d" },
  { id: "MA50", study: "ma" as const, length: 50, type: "SMA" as const, color: "#1dcf6f" },
  { id: "EMA10", study: "ema" as const, length: 10, type: "EMA" as const, color: "#49bee3" },
  { id: "EMA50", study: "ema" as const, length: 50, type: "EMA" as const, color: "#1dcf6f" },
  { id: "EMA200", study: "ema" as const, length: 200, type: "EMA" as const, color: "#d452e9" },
];

export const DEFAULT_VISIBLE_BARS = 90;

export const INDICATOR_SETTINGS_KEY = "vndirect-chart:indicator-settings";
