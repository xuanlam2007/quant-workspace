"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  PriceScaleMode,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import {
  createLineToolsPlugin,
  type ILineToolsPlugin,
  type LineToolType,
} from "lightweight-charts-line-tools-core";
import {
  LineToolHorizontalLine,
  LineToolHorizontalRay,
  LineToolRay,
  LineToolTrendLine,
} from "lightweight-charts-line-tools-lines";
import { LineToolRectangle } from "lightweight-charts-line-tools-rectangle";
import { LineToolFibRetracement } from "lightweight-charts-line-tools-fib-retracement";
import { LineToolPriceRange } from "lightweight-charts-line-tools-price-range";
import { LineToolLongShortPosition } from "lightweight-charts-line-tools-long-short-position";
import { LineToolText } from "lightweight-charts-line-tools-text";
import { fetchHistory, type Bar } from "@/lib/dchart-api";
import { connectPriceFeed, type ConnStatus } from "@/lib/dchart-socket";
import { bucketStart, mergeTick } from "@/lib/bar-builder";

const SYMBOLS = ["VN30", "VNINDEX"];
const RESOLUTIONS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" },
  { value: "M", label: "1M" },
];

const TIMEFRAME_GROUPS = [
  { label: "PHÚT", options: [{ value: "1", label: "1 phút" }, { value: "5", label: "5 phút" }, { value: "15", label: "15 phút" }, { value: "30", label: "30 phút" }] },
  { label: "GIỜ", options: [{ value: "60", label: "1 giờ" }] },
  { label: "NGÀY", options: [{ value: "D", label: "1 ngày" }, { value: "W", label: "1 tuần" }, { value: "M", label: "1 tháng" }] },
];

const RANGE_PRESETS = [
  { label: "5y", days: 365 * 5 },
  { label: "1y", days: 365 },
  { label: "3p", days: 90 },
  { label: "1p", days: 30 },
  { label: "5n", days: 5 },
  { label: "1n", days: 1 },
];

type DrawingTool = { type: LineToolType; label: string; title: string };

const DRAWING_TOOLS: DrawingTool[] = [
  { type: "TrendLine", label: "╱", title: "Trend line" },
  { type: "Ray", label: "→", title: "Ray" },
  { type: "HorizontalLine", label: "-", title: "Horizontal line" },
  { type: "HorizontalRay", label: "⇢", title: "Horizontal ray" },
  { type: "Rectangle", label: "▭", title: "Rectangle" },
  { type: "FibRetracement", label: "F", title: "Fibonacci retracement" },
  { type: "PriceRange", label: "↕", title: "Price range" },
  { type: "LongShortPosition", label: "R", title: "Long / short position" },
  { type: "Text", label: "T", title: "Text note" },
];

function drawingStorageKey(symbol: string, resolution: string) {
  return `vndirect-chart:drawings:${symbol}:${resolution}`;
}

type MaPoint = { time: Bar["time"]; value: number };
type MaType = "SMA" | "EMA" | "WMA";

function calculateMa(points: MaPoint[], length: number, type: MaType): MaPoint[] {
  if (points.length < length) return [];
  if (type === "EMA") {
    const multiplier = 2 / (length + 1);
    let value = points.slice(0, length).reduce((sum, point) => sum + point.value, 0) / length;
    const values = [{ time: points[length - 1].time, value }];
    for (let index = length; index < points.length; index++) {
      value = (points[index].value - value) * multiplier + value;
      values.push({ time: points[index].time, value });
    }
    return values;
  }
  if (type === "WMA") {
    const divisor = (length * (length + 1)) / 2;
    return points.slice(length - 1).map((point, outputIndex) => ({
      time: point.time,
      value: points.slice(outputIndex, outputIndex + length).reduce((sum, item, index) => sum + item.value * (index + 1), 0) / divisor,
    }));
  }
  let total = points.slice(0, length).reduce((sum, point) => sum + point.value, 0);
  const values = [{ time: points[length - 1].time, value: total / length }];
  for (let index = length; index < points.length; index++) {
    total += points[index].value - points[index - length].value;
    values.push({ time: points[index].time, value: total / length });
  }
  return values;
}

function volumeMa(bars: Bar[], length: number) {
  const volumePoints = bars.map((bar) => ({ time: bar.time, value: bar.volume }));
  // VNDirect hiển thị Volume MA gốc, đường làm mượt mặc định bị ẩn.
  return calculateMa(volumePoints, length, "SMA");
}

type StudyId = "volume" | "ma" | "ema" | "macd" | "rsi" | "boll";

const STUDY_CATALOG: Array<{ id: StudyId; label: string; description: string; color: string }> = [
  { id: "volume", label: "Khối lượng", description: "20 SMA 9", color: "#1f6fd1" },
  { id: "ma", label: "Moving Average", description: "MA 20, 50", color: "#f7941d" },
  { id: "ema", label: "Moving Average Exponential", description: "EMA 10, 50, 200", color: "#49bee3" },
  { id: "macd", label: "MACD", description: "12, 26, 9", color: "#2962ff" },
  { id: "rsi", label: "Relative Strength Index", description: "RSI 14", color: "#7e57c2" },
  { id: "boll", label: "Bollinger Bands", description: "20, 2", color: "#ff6d00" },
];

const PRICE_INDICATORS = [
  { id: "MA20", study: "ma" as const, length: 20, type: "SMA" as const, color: "#f7941d" },
  { id: "MA50", study: "ma" as const, length: 50, type: "SMA" as const, color: "#1dcf6f" },
  { id: "EMA10", study: "ema" as const, length: 10, type: "EMA" as const, color: "#49bee3" },
  { id: "EMA50", study: "ema" as const, length: 50, type: "EMA" as const, color: "#1dcf6f" },
  { id: "EMA200", study: "ema" as const, length: 200, type: "EMA" as const, color: "#d452e9" },
];

const INDICATOR_SETTINGS_KEY = "vndirect-chart:indicator-settings";

function priceIndicatorData(bars: Bar[], length: number, type: MaType) {
  return calculateMa(bars.map((bar) => ({ time: bar.time, value: bar.close })), length, type);
}

function bollingerData(bars: Bar[], band: "upper" | "middle" | "lower", length = 20, multiplier = 2): MaPoint[] {
  if (bars.length < length) return [];
  return bars.slice(length - 1).map((bar, outputIndex) => {
    const window = bars.slice(outputIndex, outputIndex + length);
    const mean = window.reduce((sum, item) => sum + item.close, 0) / length;
    const deviation = Math.sqrt(window.reduce((sum, item) => sum + (item.close - mean) ** 2, 0) / length);
    const value = band === "upper" ? mean + multiplier * deviation : band === "lower" ? mean - multiplier * deviation : mean;
    return { time: bar.time, value };
  });
}

function macdData(bars: Bar[]) {
  const close = bars.map((bar) => ({ time: bar.time, value: bar.close }));
  const fastByTime = new Map(calculateMa(close, 12, "EMA").map((point) => [Number(point.time), point.value]));
  const macd = calculateMa(close, 26, "EMA").flatMap((point) => {
    const fast = fastByTime.get(Number(point.time));
    return fast === undefined ? [] : [{ time: point.time, value: fast - point.value }];
  });
  const signal = calculateMa(macd, 9, "EMA");
  const signalByTime = new Map(signal.map((point) => [Number(point.time), point.value]));
  const histogram = macd.flatMap((point) => {
    const signalValue = signalByTime.get(Number(point.time));
    if (signalValue === undefined) return [];
    const value = point.value - signalValue;
    return [{ time: point.time, value, color: value >= 0 ? "rgba(83,185,135,.65)" : "rgba(235,77,92,.65)" }];
  });
  return { macd, signal, histogram };
}

function rsiData(bars: Bar[], length = 14): MaPoint[] {
  if (bars.length <= length) return [];
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= length; index++) {
    const change = bars[index].close - bars[index - 1].close;
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= length;
  averageLoss /= length;
  const values: MaPoint[] = [];
  const append = (index: number) => {
    const value = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    values.push({ time: bars[index].time, value });
  };
  append(length);
  for (let index = length + 1; index < bars.length; index++) {
    const change = bars[index].close - bars[index - 1].close;
    averageGain = (averageGain * (length - 1) + Math.max(change, 0)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(-change, 0)) / length;
    append(index);
  }
  return values;
}

function candleColor(bar: Bar) {
  return bar.close > bar.open ? "#53B987" : "#EB4D5C";
}

function volumeColor(bar: Bar, previousClose?: number) {
  const isGrowing = previousClose === undefined ? bar.close >= bar.open : bar.close >= previousClose;
  return isGrowing ? "rgba(99, 200, 155, 0.55)" : "rgba(223, 95, 104, 0.55)";
}


function isTradingSessionTime(time: Bar["time"], resolution: string) {
  if (["D", "W", "M"].includes(resolution)) return true;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(Number(time) * 1000));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return false;

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  return (minutes >= 9 * 60 && minutes <= 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes <= 14 * 60 + 45);
}

function formatVolume(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function formatChartTime(time: unknown) {
  const timestamp = Number(time);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function rangeForResolution(resolution: string, rangeDays?: number): { from: number; to: number } {
  const to = Math.floor(Date.now() / 1000);
  const daysBack = rangeDays ?? (resolution === "M" ? 3650 : resolution === "W" ? 1825 : resolution === "D" ? 730 : resolution === "60" ? 30 : 5);
  return { from: to - daysBack * 86400, to };
}

function futureTimelinePoints(lastTime: number, resolution: string, count = 500) {
  const step = resolution === "M" ? 2592000 : resolution === "W" ? 604800 : resolution === "D" ? 86400 : Number(resolution) * 60;
  return Array.from({ length: count }, (_, index) => ({ time: (lastTime + step * (index + 1)) as Bar["time"] }));
}

// Giữ khung nhìn đầu tiên hữu ích khi đổi khung thời gian
const INITIAL_VISIBLE_BARS: Record<string, number> = {
  "1": 30,
  "5": 36,
  "15": 32,
  "60": 30,
  D: 90,
  W: 104,
  M: 60,
};

export default function Chart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumeSmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceIndicatorSeriesRef = useRef(new Map<string, ISeriesApi<"Line">>());
  const macdSeriesRef = useRef<{
    histogram: ISeriesApi<"Histogram">;
    macd: ISeriesApi<"Line">;
    signal: ISeriesApi<"Line">;
  } | null>(null);
  const rsiSeriesRef = useRef<{
    rsi: ISeriesApi<"Line">;
    upper: ISeriesApi<"Line">;
    lower: ISeriesApi<"Line">;
  } | null>(null);
  const timelineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lineToolsRef = useRef<ILineToolsPlugin | null>(null);
  const currentBarRef = useRef<Bar | undefined>(undefined);
  const barsByTimeRef = useRef(new Map<number, Bar>());
  const previousCloseByTimeRef = useRef(new Map<number, number>());
  const feedRef = useRef<ReturnType<typeof connectPriceFeed> | null>(null);
  const reconcileTimerRef = useRef<number | undefined>(undefined);
  const lastRealtimeBucketRef = useRef<number | undefined>(undefined);
  const drawingKeyRef = useRef("");
  const drawingHistoryRef = useRef<string[]>(["[]"]);
  const resolutionRef = useRef("D");
  const maSettingsRef = useRef<{ length: number; type: MaType; smoothingLength: number }>({ length: 20, type: "SMA", smoothingLength: 9 });
  const drawingGestureRef = useRef(false);
  const verticalPanRef = useRef<{
    startX: number;
    startY: number;
    startPriceRange: { from: number; to: number };
    startLogicalRange: { from: number; to: number };
    mode: "pending" | "pan";
  } | null>(null);

  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [resolution, setResolution] = useState("D");
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [visibleBar, setVisibleBar] = useState<Bar | undefined>(undefined);
  const [rangeDays, setRangeDays] = useState<number | undefined>(undefined);
  const [scaleMode, setScaleMode] = useState<"normal" | "percent" | "log">("normal");
  const [autoScale, setAutoScale] = useState(true);
  const [activeStudies, setActiveStudies] = useState<StudyId[]>(["volume"]);
  const [indicatorSettingsLoaded, setIndicatorSettingsLoaded] = useState(false);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Giữ thiết lập MA để dùng cho chỉ báo sau này
  const [maLength, setMaLength] = useState(20);
  const [maType, setMaType] = useState<MaType>("SMA");
  const [smoothingLength, setSmoothingLength] = useState(9);
  resolutionRef.current = resolution;
  maSettingsRef.current = { length: maLength, type: maType, smoothingLength };
  const [lastPrice, setLastPrice] = useState<string>("N/A");

  const updateStudySeries = (bars: Bar[]) => {
    PRICE_INDICATORS.forEach((indicator) => {
      priceIndicatorSeriesRef.current.get(indicator.id)?.setData(
        priceIndicatorData(bars, indicator.length, indicator.type)
      );
    });
    priceIndicatorSeriesRef.current.get("BOLL_UPPER")?.setData(bollingerData(bars, "upper"));
    priceIndicatorSeriesRef.current.get("BOLL_MIDDLE")?.setData(bollingerData(bars, "middle"));
    priceIndicatorSeriesRef.current.get("BOLL_LOWER")?.setData(bollingerData(bars, "lower"));

    if (macdSeriesRef.current) {
      const values = macdData(bars);
      macdSeriesRef.current.histogram.setData(values.histogram);
      macdSeriesRef.current.macd.setData(values.macd);
      macdSeriesRef.current.signal.setData(values.signal);
    }
    if (rsiSeriesRef.current) {
      const values = rsiData(bars);
      rsiSeriesRef.current.rsi.setData(values);
      rsiSeriesRef.current.upper.setData(values.map((point) => ({ time: point.time, value: 70 })));
      rsiSeriesRef.current.lower.setData(values.map((point) => ({ time: point.time, value: 30 })));
    }
  };

  // Tạo biểu đồ một lần khi gắn component
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#8b92a5",
      },
      localization: {
        timeFormatter: formatChartTime,
      },
      grid: {
        vertLines: { color: "#303948" },
        horzLines: { color: "#303948" },
      },
      // Cho phép đường ngắm và nhãn giá di chuyển tự do
      crosshair: { mode: CrosshairMode.Normal },
      leftPriceScale: {
        visible: true,
        borderColor: "#262b38",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      rightPriceScale: { visible: false, borderColor: "#262b38" },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#262b38",
        barSpacing: 14,
        minBarSpacing: 6,
        rightOffset: 6,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: false,
        tickMarkFormatter: (time: Time) => new Intl.DateTimeFormat("en-GB", ["D", "W", "M"].includes(resolutionRef.current)
          ? { timeZone: "Asia/Bangkok", day: "2-digit", month: "short" }
          : { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }
        ).format(new Date(Number(time) * 1000)),
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: false,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      priceScaleId: "left",
      upColor: "#53B987",
      downColor: "#EB4D5C",
      borderVisible: false,
      wickUpColor: "#53B987",
      wickDownColor: "#EB4D5C",
      priceLineVisible: true,
      priceLineColor: "#EB4D5C",
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const volumeSmaSeries = chart.addSeries(LineSeries, {
      color: "#1f6fd1",
      lineWidth: 3,
      lineType: LineType.Simple,
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const timelineSeries = chart.addSeries(LineSeries, {
      priceScaleId: "",
      lineVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      // Giữ biểu đồ khối lượng trong vùng chính như VNDirect
      scaleMargins: { top: 0.04, bottom: 0 },
      visible: true,
      autoScale: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    volumeSmaSeriesRef.current = volumeSmaSeries;
    timelineSeriesRef.current = timelineSeries;

    chart.subscribeCrosshairMove((param) => {
      const time = param.time ? Number(param.time) : undefined;
      setVisibleBar(time ? barsByTimeRef.current.get(time) : currentBarRef.current);
    });

    const lineTools = createLineToolsPlugin(chart, series);
    lineTools.registerLineTool("TrendLine", LineToolTrendLine);
    lineTools.registerLineTool("Ray", LineToolRay);
    lineTools.registerLineTool("HorizontalLine", LineToolHorizontalLine);
    lineTools.registerLineTool("HorizontalRay", LineToolHorizontalRay);
    lineTools.registerLineTool("Rectangle", LineToolRectangle);
    lineTools.registerLineTool("FibRetracement", LineToolFibRetracement);
    lineTools.registerLineTool("PriceRange", LineToolPriceRange);
    lineTools.registerLineTool("LongShortPosition", LineToolLongShortPosition);
    lineTools.registerLineTool("Text", LineToolText);
    // Giữ con trỏ và điểm vẽ đúng vị trí chuột
    lineTools.setMagnetThreshold(0);
    lineTools.subscribeLineToolsAfterEdit(() => {
      const drawingState = lineTools.exportLineTools();
      if (drawingHistoryRef.current.at(-1) !== drawingState) {
        drawingHistoryRef.current.push(drawingState);
      }
      if (drawingKeyRef.current) {
        localStorage.setItem(drawingKeyRef.current, drawingState);
      }
    });
    lineToolsRef.current = lineTools;

    // Bổ sung thao tác kéo dọc để dịch vùng giá đang xem
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || drawingGestureRef.current) return;
      const selectedTools = lineToolsRef.current?.getSelectedLineTools();
      if (selectedTools && selectedTools !== "[]") return;
      const element = containerRef.current;
      const currentSeries = seriesRef.current;
      if (!element || !currentSeries) return;

      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const drawingWidth = chart.paneSize().width;
      // Để Lightweight Charts xử lý thao tác trên trục
      if (x < 55 || x > drawingWidth - 4 || y < 0 || y > chart.paneSize().height) return;

      const visibleRange = chart.priceScale("left").getVisibleRange();
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (!visibleRange || !logicalRange) return;
      verticalPanRef.current = {
        startX: x,
        startY: y,
        startPriceRange: { from: Number(visibleRange.from), to: Number(visibleRange.to) },
        startLogicalRange: { from: Number(logicalRange.from), to: Number(logicalRange.to) },
        mode: "pending",
      };
    };

    const onMouseMove = (event: MouseEvent) => {
      const gesture = verticalPanRef.current;
      if (!gesture) return;
      const element = containerRef.current;
      const currentSeries = seriesRef.current;
      if (!element || !currentSeries) return;

      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const dx = Math.abs(x - gesture.startX);
      const dy = Math.abs(y - gesture.startY);

      if (gesture.mode === "pending" && Math.max(dx, dy) < 4) return;
      if (gesture.mode === "pending") {
        gesture.mode = "pan";
        chart.applyOptions({ handleScroll: { pressedMouseMove: false } });
      }

      const paneWidth = Math.max(1, chart.paneSize().width);
      const paneHeight = Math.max(1, chart.paneSize().height);
      const logicalWidth = gesture.startLogicalRange.to - gesture.startLogicalRange.from;
      const logicalDelta = ((x - gesture.startX) / paneWidth) * logicalWidth;
      const priceHeight = gesture.startPriceRange.to - gesture.startPriceRange.from;
      const priceDelta = ((y - gesture.startY) / paneHeight) * priceHeight;

      chart.timeScale().setVisibleLogicalRange({
        from: gesture.startLogicalRange.from - logicalDelta,
        to: gesture.startLogicalRange.to - logicalDelta,
      });
      chart.priceScale("left").setVisibleRange({
        from: gesture.startPriceRange.from + priceDelta,
        to: gesture.startPriceRange.to + priceDelta,
      });
      event.preventDefault();
    };

    const onWheel = (event: WheelEvent) => {
      const currentChart = chartRef.current;
      if (!currentChart) return;

      event.preventDefault();

      const range = currentChart.timeScale().getVisibleLogicalRange();
      if (!range) return;

      const currentWidth = range.to - range.from;
      const factor = event.deltaY > 0 ? 1.07 : 1 / 1.07;
      const nextWidth = Math.max(8, Math.min(300, currentWidth * factor));
      const bars = [...barsByTimeRef.current.values()].sort((a, b) => Number(a.time) - Number(b.time));
      const lastBarIndex = Math.max(0, bars.length - 1);
      const rightPadding = Math.min(6, Math.max(2, nextWidth * 0.08));
      const rightEdge = Math.min(range.to, lastBarIndex + rightPadding);

      currentChart.timeScale().setVisibleLogicalRange({
        from: rightEdge - nextWidth,
        to: rightEdge,
      });
    };

    const clearMouseGesture = () => {
      if (verticalPanRef.current?.mode === "pan") {
        chart.applyOptions({ handleScroll: { pressedMouseMove: true } });
      }
      verticalPanRef.current = null;
      drawingGestureRef.current = false;
    };

    const element = containerRef.current;
    if (!element) return;
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", clearMouseGesture);

    // Đồng bộ kích thước biểu đồ và plugin ngay từ lần bố trí đầu tiên
    const syncChartSize = () => {
      const element = containerRef.current;
      if (!element) return;
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      if (width > 0 && height > 0) chart.resize(width, height);
    };
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncChartSize);
    });
    resizeObserver.observe(containerRef.current);
    requestAnimationFrame(syncChartSize);

    return () => {
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", clearMouseGesture);
      resizeObserver.disconnect();
      lineTools.destroy();
      lineToolsRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      volumeSmaSeriesRef.current = null;
      priceIndicatorSeriesRef.current.clear();
      macdSeriesRef.current = null;
      rsiSeriesRef.current = null;
      timelineSeriesRef.current = null;
    };
  }, []);

  // Tải lịch sử và kết nối lại dữ liệu trực tiếp khi mã hoặc khung thời gian đổi
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    let cancelled = false;
    currentBarRef.current = undefined;
    drawingKeyRef.current = drawingStorageKey(symbol, resolution);
    lineToolsRef.current?.removeAllLineTools();

    (async () => {
      const { from, to } = rangeForResolution(resolution, rangeDays);
      const bars = await fetchHistory(symbol, resolution, from, to);
      if (cancelled) return;
      const chartBars = bars.filter((bar) => isTradingSessionTime(bar.time, resolution));
      series.setData(chartBars);
      if (chartBars.length) series.applyOptions({ priceLineColor: candleColor(chartBars[chartBars.length - 1]) });
      const volumeBars = chartBars;
      volumeSeriesRef.current?.setData(volumeBars.map((bar, index) => ({
        time: bar.time,
        value: bar.volume,
        color: volumeColor(bar, index > 0 ? volumeBars[index - 1].close : undefined),
      })));
      const settings = maSettingsRef.current;
      volumeSmaSeriesRef.current?.setData(volumeMa(volumeBars, settings.length));
      updateStudySeries(chartBars);
      if (chartBars.length) timelineSeriesRef.current?.setData(futureTimelinePoints(Number(chartBars[chartBars.length - 1].time), resolution));
      barsByTimeRef.current = new Map(chartBars.map((bar) => [Number(bar.time), bar]));
      previousCloseByTimeRef.current = new Map(chartBars.slice(1).map((bar, index) => [Number(bar.time), chartBars[index].close]));
      const visibleBars = INITIAL_VISIBLE_BARS[resolution] ?? 30;

      // Gọi lại sau khi kích thước biểu đồ ổn định để tránh nến bị nén
      const focusLatestBars = () => {
        if (cancelled) return;

        if (rangeDays !== undefined) {
          // Chế độ đặt sẵn hiển thị toàn bộ dữ liệu đã tải
          chart.timeScale().fitContent();
        } else if (chartBars.length > visibleBars) {
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, chartBars.length - visibleBars),
            to: chartBars.length + 6,
          });
        } else {
          chart.timeScale().fitContent();
        }

        // Bật lại tự động co giãn sau khi đổi mã hoặc khung thời gian
        chart.priceScale("left").applyOptions({ autoScale: true });
      };

      focusLatestBars();
      requestAnimationFrame(() => {
        requestAnimationFrame(focusLatestBars);
      });
      const savedDrawings = localStorage.getItem(drawingKeyRef.current);
      if (savedDrawings) lineToolsRef.current?.importLineTools(savedDrawings);
      drawingHistoryRef.current = [savedDrawings ?? "[]"];
      if (chartBars.length) {
        currentBarRef.current = chartBars[chartBars.length - 1];
        setLastPrice(currentBarRef.current.close.toFixed(2));
        setVisibleBar(currentBarRef.current);
      }
    })();

    const refreshVolumeMa = () => {
      const allBars = [...barsByTimeRef.current.values()]
        .filter((bar) => isTradingSessionTime(bar.time, resolution))
        .sort((a, b) => Number(a.time) - Number(b.time));
      const settings = maSettingsRef.current;
      volumeSmaSeriesRef.current?.setData(
        volumeMa(allBars, settings.length)
      );
    };

    const reconcileCurrentBar = (bucket: number) => {
      if (reconcileTimerRef.current !== undefined) {
        window.clearTimeout(reconcileTimerRef.current);
      }

      // Lấy lại OHLC phút vừa mở để giá mở cửa và màu nến khớp VNDirect
      reconcileTimerRef.current = window.setTimeout(async () => {
        reconcileTimerRef.current = undefined;
        try {
          const from = bucket - 5 * 60;
          const to = Math.floor(Date.now() / 1000) + 60;
          const recentBars = await fetchHistory(symbol, resolution, from, to);
          if (cancelled) return;

          const authoritative = recentBars.find((bar) => Number(bar.time) === bucket);
          const live = currentBarRef.current;
          if (!authoritative || !live || Number(live.time) !== bucket) return;

          const reconciled: Bar = {
            time: live.time,
            open: authoritative.open,
            high: Math.max(authoritative.high, live.high),
            low: Math.min(authoritative.low, live.low),
            close: live.close,
            volume: Math.max(authoritative.volume, live.volume),
          };

          currentBarRef.current = reconciled;
          barsByTimeRef.current.set(bucket, reconciled);
          seriesRef.current?.update(reconciled);
          seriesRef.current?.applyOptions({ priceLineColor: candleColor(reconciled) });
          if (isTradingSessionTime(reconciled.time, resolution)) {
            volumeSeriesRef.current?.update({
              time: reconciled.time,
              value: reconciled.volume,
              color: volumeColor(reconciled, previousCloseByTimeRef.current.get(Number(reconciled.time))),
            });
            refreshVolumeMa();
          }
          setVisibleBar(reconciled);
        } catch {
          // Tiếp tục nhận dữ liệu nếu đối chiếu lịch sử thất bại
        }
      }, 1200);
    };

    const currentBar = currentBarRef.current as Bar | undefined;
    lastRealtimeBucketRef.current = currentBar
      ? Number(currentBar.time)
      : undefined;

    feedRef.current?.close();
    feedRef.current = connectPriceFeed(
      symbol,
      (tick) => {
        const bucket = bucketStart(tick.time, resolution);
        const bucketNumber = Number(bucket);
        if (!isTradingSessionTime(bucket, resolution)) {
          setLastPrice(tick.price.toFixed(2));
          return;
        }
        const isNewBucket = lastRealtimeBucketRef.current !== bucketNumber;
        const previousBar = currentBarRef.current;
        if (isNewBucket && previousBar) {
          previousCloseByTimeRef.current.set(bucketNumber, previousBar.close);
        }

        currentBarRef.current = mergeTick(currentBarRef.current, tick.price, tick.volume, bucket);
        lastRealtimeBucketRef.current = bucketNumber;
        if (isNewBucket) timelineSeriesRef.current?.setData(futureTimelinePoints(bucketNumber, resolution));

        seriesRef.current?.update(currentBarRef.current);
        seriesRef.current?.applyOptions({ priceLineColor: candleColor(currentBarRef.current) });
        if (isTradingSessionTime(currentBarRef.current.time, resolution)) {
          volumeSeriesRef.current?.update({
            time: currentBarRef.current.time,
            value: currentBarRef.current.volume,
            color: volumeColor(currentBarRef.current, previousCloseByTimeRef.current.get(Number(currentBarRef.current.time))),
          });
        }
        barsByTimeRef.current.set(bucketNumber, currentBarRef.current);

        if (isTradingSessionTime(currentBarRef.current.time, resolution)) {
          const allBars = [...barsByTimeRef.current.values()]
            .filter((bar) => isTradingSessionTime(bar.time, resolution))
            .sort((a, b) => Number(a.time) - Number(b.time));
          const settings = maSettingsRef.current;
          const latestVolumeSma = volumeMa(allBars, settings.length).at(-1);
          if (latestVolumeSma) volumeSmaSeriesRef.current?.update(latestVolumeSma);
          updateStudySeries(allBars);
        }

        if (isNewBucket) reconcileCurrentBar(bucketNumber);

        setLastPrice(tick.price.toFixed(2));
        setVisibleBar(currentBarRef.current);
      },
      setStatus
    );

    return () => {
      cancelled = true;
      if (reconcileTimerRef.current !== undefined) {
        window.clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = undefined;
      }
      feedRef.current?.close();
      feedRef.current = null;
    };
  }, [symbol, resolution, rangeDays]);

  useEffect(() => {
    const bars = [...barsByTimeRef.current.values()]
      .filter((bar) => isTradingSessionTime(bar.time, resolution))
      .sort((a, b) => Number(a.time) - Number(b.time));
    volumeSmaSeriesRef.current?.setData(volumeMa(bars, maLength));
  }, [maLength]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const active = new Set(activeStudies);
    PRICE_INDICATORS.forEach((indicator) => {
      let series = priceIndicatorSeriesRef.current.get(indicator.id);
      if (active.has(indicator.study) && !series) {
        series = chart.addSeries(LineSeries, {
          color: indicator.color,
          lineWidth: 2,
          priceScaleId: "left",
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        priceIndicatorSeriesRef.current.set(indicator.id, series);
      } else if (!active.has(indicator.study) && series) {
        chart.removeSeries(series);
        priceIndicatorSeriesRef.current.delete(indicator.id);
        series = undefined;
      }
    });

    const bollingerLines = [
      { id: "BOLL_UPPER", color: "#2962ff" },
      { id: "BOLL_MIDDLE", color: "#ff6d00" },
      { id: "BOLL_LOWER", color: "#2962ff" },
    ];
    bollingerLines.forEach((indicator) => {
      let series = priceIndicatorSeriesRef.current.get(indicator.id);
      if (active.has("boll") && !series) {
        series = chart.addSeries(LineSeries, {
          color: indicator.color,
          lineWidth: 2,
          priceScaleId: "left",
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        priceIndicatorSeriesRef.current.set(indicator.id, series);
      } else if (!active.has("boll") && series) {
        chart.removeSeries(series);
        priceIndicatorSeriesRef.current.delete(indicator.id);
      }
    });

    if (macdSeriesRef.current) {
      chart.removeSeries(macdSeriesRef.current.histogram);
      chart.removeSeries(macdSeriesRef.current.macd);
      chart.removeSeries(macdSeriesRef.current.signal);
      macdSeriesRef.current = null;
    }
    if (rsiSeriesRef.current) {
      chart.removeSeries(rsiSeriesRef.current.rsi);
      chart.removeSeries(rsiSeriesRef.current.upper);
      chart.removeSeries(rsiSeriesRef.current.lower);
      rsiSeriesRef.current = null;
    }
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

    let paneIndex = 1;
    if (active.has("macd")) {
      const histogram = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex);
      const macd = chart.addSeries(LineSeries, { color: "#2962ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, paneIndex);
      const signal = chart.addSeries(LineSeries, { color: "#ff6d00", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, paneIndex);
      macdSeriesRef.current = { histogram, macd, signal };
      chart.panes()[paneIndex]?.setHeight(140);
      paneIndex++;
    }
    if (active.has("rsi")) {
      const rsi = chart.addSeries(LineSeries, { color: "#7e57c2", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, paneIndex);
      const upper = chart.addSeries(LineSeries, { color: "#596273", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, paneIndex);
      const lower = chart.addSeries(LineSeries, { color: "#596273", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, paneIndex);
      rsiSeriesRef.current = { rsi, upper, lower };
      chart.panes()[paneIndex]?.setHeight(140);
    }

    const volumeVisible = active.has("volume");
    volumeSeriesRef.current?.applyOptions({ visible: volumeVisible });
    volumeSmaSeriesRef.current?.applyOptions({ visible: volumeVisible });
    const bars = [...barsByTimeRef.current.values()]
      .filter((bar) => isTradingSessionTime(bar.time, resolution))
      .sort((a, b) => Number(a.time) - Number(b.time));
    updateStudySeries(bars);
  }, [activeStudies, resolution]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(INDICATOR_SETTINGS_KEY) ?? "null") as {
        activeStudies?: unknown;
        maLength?: unknown;
        maType?: unknown;
        smoothingLength?: unknown;
      } | null;
      if (saved) {
        const validIds = new Set(STUDY_CATALOG.map((indicator) => indicator.id));
        if (Array.isArray(saved.activeStudies)) {
          const active = saved.activeStudies.filter((id): id is StudyId => typeof id === "string" && validIds.has(id as StudyId));
          setActiveStudies(active);
        }
        if (typeof saved.maLength === "number") setMaLength(Math.max(2, Math.min(500, saved.maLength)));
        if (saved.maType === "SMA" || saved.maType === "EMA" || saved.maType === "WMA") setMaType(saved.maType);
        if (typeof saved.smoothingLength === "number") setSmoothingLength(Math.max(1, Math.min(500, saved.smoothingLength)));
      }
    } catch {
      // Giữ cấu hình mặc định khi dữ liệu lưu trữ không hợp lệ.
    } finally {
      setIndicatorSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!indicatorSettingsLoaded) return;
    localStorage.setItem(INDICATOR_SETTINGS_KEY, JSON.stringify({
      activeStudies,
      maLength,
      maType,
      smoothingLength,
    }));
  }, [activeStudies, indicatorSettingsLoaded, maLength, maType, smoothingLength]);

  useEffect(() => {
    chartRef.current?.priceScale("left").applyOptions({
      autoScale,
      mode: scaleMode === "percent" ? PriceScaleMode.Percentage : scaleMode === "log" ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [autoScale, scaleMode]);

  useEffect(() => {
    lineToolsRef.current?.setLocked(drawingsLocked);
  }, [drawingsLocked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        const beforeDelete = lineToolsRef.current?.exportLineTools();
        lineToolsRef.current?.removeSelectedLineTools();
        if (drawingKeyRef.current && lineToolsRef.current) {
          const drawingState = lineToolsRef.current.exportLineTools();
          if (beforeDelete !== drawingState) drawingHistoryRef.current.push(drawingState);
          localStorage.setItem(drawingKeyRef.current, drawingState);
        }
      }
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (drawingHistoryRef.current.length > 1 && lineToolsRef.current) {
          drawingHistoryRef.current.pop();
          const previousState = drawingHistoryRef.current.at(-1) ?? "[]";
          lineToolsRef.current.removeAllLineTools();
          lineToolsRef.current.importLineTools(previousState);
          if (drawingKeyRef.current) localStorage.setItem(drawingKeyRef.current, previousState);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const startDrawing = (type: LineToolType) => {
    if (!drawingsLocked) {
      drawingGestureRef.current = true;
      // Tắt hút điểm riêng cho từng công cụ để điểm neo không tự nhảy
      lineToolsRef.current?.addLineTool(type);
    }
  };

  const clearDrawings = () => {
    lineToolsRef.current?.removeAllLineTools();
    drawingHistoryRef.current.push("[]");
    if (drawingKeyRef.current) localStorage.removeItem(drawingKeyRef.current);
  };

  const undoDrawings = () => {
    if (drawingHistoryRef.current.length <= 1 || !lineToolsRef.current) return;
    drawingHistoryRef.current.pop();
    const previousState = drawingHistoryRef.current.at(-1) ?? "[]";
    lineToolsRef.current.removeAllLineTools();
    lineToolsRef.current.importLineTools(previousState);
    if (drawingKeyRef.current) localStorage.setItem(drawingKeyRef.current, previousState);
  };

  const quoteBar = visibleBar ?? currentBarRef.current;
  const previousClose = quoteBar ? previousCloseByTimeRef.current.get(Number(quoteBar.time)) : undefined;
  const change = quoteBar && previousClose ? quoteBar.close - previousClose : 0;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  const quoteClass = change >= 0 ? "quote--up" : "quote--down";
  const sortedBars = [...barsByTimeRef.current.values()]
    .filter((bar) => isTradingSessionTime(bar.time, resolution))
    .sort((a, b) => Number(a.time) - Number(b.time));
  const currentVolumeMa = volumeMa(sortedBars, maLength).at(-1)?.value;

  const applyRangePreset = (preset: (typeof RANGE_PRESETS)[number]) => {
    setRangeDays(preset.days);
  };

  const toggleStudy = (id: StudyId) => {
    setActiveStudies((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const normalizedIndicatorSearch = indicatorSearch.trim().toLocaleLowerCase("vi");
  const filteredStudies = STUDY_CATALOG.filter((study) =>
    `${study.label} ${study.description}`.toLocaleLowerCase("vi").includes(normalizedIndicatorSearch)
  );

  const downloadSnapshot = () => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${symbol}-${resolution}-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.getElementById("app")?.requestFullscreen();
  };

  return (
    <div id="app">
      <header className="chart-header">
        <div className="symbol-row">
          <div className="product-mark" title="VNDIRECT chart workspace" aria-label="VNDIRECT chart workspace">D</div>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <details className="timeframe-menu" open={timeframeMenuOpen} onToggle={(event) => setTimeframeMenuOpen(event.currentTarget.open)}>
            <summary>{RESOLUTIONS.find((item) => item.value === resolution)?.label ?? "1D"}</summary>
            <div className="timeframe-menu__panel">
              {TIMEFRAME_GROUPS.map((group) => (
                <div className="timeframe-menu__group" key={group.label}>
                  <div className="timeframe-menu__heading">{group.label}</div>
                  {group.options.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={option.value === resolution ? "timeframe-menu__option timeframe-menu__option--active" : "timeframe-menu__option"}
                      onClick={() => { setRangeDays(undefined); setResolution(option.value); setTimeframeMenuOpen(false); }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </details>
          <details className="indicator-menu" open={indicatorMenuOpen} onToggle={(event) => setIndicatorMenuOpen(event.currentTarget.open)}>
            <summary className="header-button">Chỉ báo <span>{activeStudies.length}</span></summary>
            <div className="indicator-menu__panel">
              <div className="indicator-menu__title">
                <strong>Các chỉ báo</strong>
                <button type="button" aria-label="Đóng danh sách chỉ báo" onClick={() => setIndicatorMenuOpen(false)}>×</button>
              </div>
              <label className="indicator-menu__search">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.6 19.2-4.3-4.3a7.5 7.5 0 1 0-1.4 1.4l4.3 4.3 1.4-1.4ZM5 10.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z" /></svg>
                <input value={indicatorSearch} onChange={(event) => setIndicatorSearch(event.target.value)} placeholder="Tìm kiếm" autoFocus />
              </label>
              <div className="indicator-menu__heading">Tên chỉ báo</div>
              <div className="indicator-menu__list">
                {filteredStudies.map((study) => (
                  <label key={study.id} className={activeStudies.includes(study.id) ? "indicator-menu__option indicator-menu__option--active" : "indicator-menu__option"}>
                    <input type="checkbox" checked={activeStudies.includes(study.id)} onChange={() => toggleStudy(study.id)} />
                    <i style={{ background: study.color }} />
                    <span><b>{study.label}</b><small>{study.id === "volume" ? `${maLength} ${maType} ${smoothingLength}` : study.description}</small></span>
                  </label>
                ))}
                {filteredStudies.length === 0 && <div className="indicator-menu__empty">Không tìm thấy chỉ báo</div>}
              </div>
            </div>
          </details>
        </div>
        <div className="status-row">
          <span className={"dot " + (status === "connected" ? "dot--on" : "dot--off")} />
          <span className="connection-label">{status}</span>
          <span id="last-price">{lastPrice}</span>
          <span className="header-separator" />
          <button className="header-icon-button" title="Download chart snapshot" aria-label="Download chart snapshot" onClick={downloadSnapshot}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5 10 3h4l1.5 2H19a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5ZM12 8a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" /></svg>
          </button>
          <button className={isFullscreen ? "header-icon-button header-button--active" : "header-icon-button"} title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={toggleFullscreen}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z" /></svg>
          </button>
        </div>
      </header>
      <div className="chart-shell">
        <aside className="drawing-toolbar" aria-label="Drawing tools">
          {DRAWING_TOOLS.map((tool) => (
            <button
              className="toolbar-button"
              key={tool.type}
              title={tool.title}
              aria-label={tool.title}
              onClick={() => startDrawing(tool.type)}
              disabled={drawingsLocked}
            >
              {tool.label}
            </button>
          ))}
          <span className="toolbar-divider" />
          <button className="toolbar-button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undoDrawings}>
            ↶
          </button>
          <button
            className={"toolbar-button " + (drawingsLocked ? "toolbar-button--active" : "")}
            title={drawingsLocked ? "Unlock drawings" : "Lock drawings"}
            aria-label={drawingsLocked ? "Unlock drawings" : "Lock drawings"}
            onClick={() => setDrawingsLocked((locked) => !locked)}
          >
            {drawingsLocked ? "🔒" : "🔓"}
          </button>
          <button className="toolbar-button" title="Delete selected drawing" aria-label="Delete selected drawing" onClick={() => {
            const beforeDelete = lineToolsRef.current?.exportLineTools();
            lineToolsRef.current?.removeSelectedLineTools();
            const drawingState = lineToolsRef.current?.exportLineTools();
            if (drawingState && drawingState !== beforeDelete) drawingHistoryRef.current.push(drawingState);
          }}>
            ⌫
          </button>
          <button className="toolbar-button toolbar-button--danger" title="Clear drawings for this symbol and timeframe" aria-label="Clear drawings" onClick={clearDrawings}>
            ×
          </button>
        </aside>
        <div className="chart-stage">
          <div className="market-data-row">
            <div className="market-data__title">
              <strong>{symbol}</strong><span>·</span><span>{RESOLUTIONS.find((item) => item.value === resolution)?.label}</span><span>· HOSE</span>
            </div>
            <div className="ohlcv-strip" aria-label="Open high low close volume">
              <span>O <b>{quoteBar?.open.toFixed(2) ?? "N/A"}</b></span>
              <span>H <b>{quoteBar?.high.toFixed(2) ?? "N/A"}</b></span>
              <span>L <b>{quoteBar?.low.toFixed(2) ?? "N/A"}</b></span>
              <span>C <b className={quoteClass}>{quoteBar?.close.toFixed(2) ?? "N/A"}</b></span>
              {previousClose !== undefined && <span className={quoteClass}>{change >= 0 ? "+" : ""}{change.toFixed(2)} ({changePercent.toFixed(2)}%)</span>}
              <span className="ohlcv-strip__volume">Vol <b>{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</b></span>
            </div>
            {activeStudies.includes("volume") && <label className="ma-control" title="Volume MA settings">
              MA
              <input type="number" min="2" max="500" value={maLength} aria-label="MA length" onChange={(event) => setMaLength(Math.max(2, Math.min(500, Number(event.target.value) || 2)))} />
              <select value={maType} onChange={(event) => setMaType(event.target.value as MaType)} aria-label="MA type">
                <option value="SMA">SMA</option>
                <option value="EMA">EMA</option>
                <option value="WMA">WMA</option>
              </select>
              <input type="number" min="1" max="500" value={smoothingLength} aria-label="Smoothing length" onChange={(event) => setSmoothingLength(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
            </label>}
          </div>
          {activeStudies.includes("volume") && <div className="indicator-data-row">
            <span className="indicator-data__name">Khối lượng {maLength} {maType} {smoothingLength}</span>
            <span className="indicator-data__volume">{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</span>
            <span className="indicator-data__ma">{currentVolumeMa !== undefined ? formatVolume(currentVolumeMa) : "N/A"}</span>
            <span className="indicator-data__actions" title="Volume indicator controls">◉ ⚙ × ···</span>
          </div>}
          <main id="chart" ref={containerRef} />
          <footer className="chart-footer">
            <div className="range-presets" aria-label="History range">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className={rangeDays === preset.days ? "chart-footer__active" : ""}
                  onClick={() => applyRangePreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
              <button title="Return to the selected timeframe's default history" onClick={() => setRangeDays(undefined)}>↻</button>
            </div>
            <div className="chart-footer__settings">
              <span>UTC+7</span>
              <button className={scaleMode === "percent" ? "chart-footer__active" : ""} onClick={() => setScaleMode((mode) => mode === "percent" ? "normal" : "percent")}>%</button>
              <button className={scaleMode === "log" ? "chart-footer__active" : ""} onClick={() => setScaleMode((mode) => mode === "log" ? "normal" : "log")}>log</button>
              <button className={autoScale ? "chart-footer__active" : ""} onClick={() => setAutoScale((enabled) => !enabled)}>tự động</button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
