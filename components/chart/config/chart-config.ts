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
  { label: "5y", days: 365 * 5, resolution: "W" },
  { label: "1y", days: 365, resolution: "W" },
  { label: "3p", days: 90, resolution: "D" },
  { label: "1p", days: 30, resolution: "D" },
  { label: "5n", days: 5, resolution: "5" },
  { label: "1n", days: 1, resolution: "1" },
];

export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DrawingIcon =
  | "trend" | "arrow" | "ray" | "extended" | "horizontal" | "horizontalRay"
  | "vertical" | "cross" | "fib" | "rectangle" | "text" | "callout"
  | "priceRange" | "position" | "positionShort" | "prediction" | "dateRange"
  | "datePriceRange" | "barsPattern" | "ghostFeed" | "projection" | "volumeProfile";

export interface DrawingToolOption {
  id: string;
  type: LineToolType;
  icon: DrawingIcon;
  title: string;
  available?: boolean;
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
      { id: "trend-line", type: "TrendLine", icon: "trend", title: "Đường xu hướng" },
      { id: "arrow", type: "Arrow", icon: "arrow", title: "Mũi tên" },
      { id: "ray", type: "Ray", icon: "ray", title: "Tia" },
      { id: "extended-line", type: "ExtendedLine", icon: "extended", title: "Đường kéo dài" },
      { id: "horizontal-line", type: "HorizontalLine", icon: "horizontal", title: "Đường ngang" },
      { id: "horizontal-ray", type: "HorizontalRay", icon: "horizontalRay", title: "Tia ngang" },
      { id: "vertical-line", type: "VerticalLine", icon: "vertical", title: "Đường dọc" },
      { id: "cross-line", type: "CrossLine", icon: "cross", title: "Đường chữ thập" },
    ],
  },
  {
    id: "fibonacci",
    icon: "fib",
    title: "Gann và Fibonacci",
    tools: [
      { id: "fib-retracement", type: "FibRetracement", icon: "fib", title: "Fibonacci thoái lui" },
    ],
  },
  {
    id: "geometry",
    icon: "rectangle",
    title: "Hình học",
    tools: [
      { id: "rectangle", type: "Rectangle", icon: "rectangle", title: "Hình chữ nhật" },
    ],
  },
  {
    id: "annotations",
    icon: "text",
    title: "Chú thích",
    tools: [
      { id: "text", type: "Text", icon: "text", title: "Văn bản" },
      { id: "callout", type: "Callout", icon: "callout", title: "Chú thích có đường dẫn" },
    ],
  },
  {
    id: "measurement",
    icon: "position",
    title: "Dự báo và đo lường",
    tools: [
      { id: "long-position", type: "LongShortPosition", icon: "position", title: "Thế giá lên" },
      { id: "short-position", type: "LongShortPosition", icon: "positionShort", title: "Thế giá xuống" },
      { id: "prediction", type: "LongShortPosition", icon: "prediction", title: "Dự đoán", available: false },
      { id: "date-range", type: "PriceRange", icon: "dateRange", title: "Phạm vi Ngày", available: false },
      { id: "price-range", type: "PriceRange", icon: "priceRange", title: "Khoảng Giá" },
      { id: "date-price-range", type: "PriceRange", icon: "datePriceRange", title: "Phạm vi Ngày và Giá", available: false },
      { id: "bars-pattern", type: "Path", icon: "barsPattern", title: "Mẫu hình Thanh", available: false },
      { id: "ghost-feed", type: "Path", icon: "ghostFeed", title: "Mô hình Ghost Feed", available: false },
      { id: "projection", type: "TrendLine", icon: "projection", title: "Phép chiếu", available: false },
      { id: "fixed-range-volume", type: "Rectangle", icon: "volumeProfile", title: "Cố định Range Volume Profile", available: false },
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
