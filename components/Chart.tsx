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

function volumeMa(bars: Bar[], length: number, type: MaType, _smoothingLength: number) {
  const volumePoints = bars.map((bar) => ({ time: bar.time, value: bar.volume }));
  return calculateMa(volumePoints, length, type);
}


function isVolumeSessionTime(time: Bar["time"]) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(Number(time) * 1000));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour < 14 || (hour === 14 && minute <= 45);
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

export default function Chart({ onSelectKLine }: { onSelectKLine: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumeSmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
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
  // Giữ thiết lập MA để dùng cho chỉ báo sau này
  const [maLength, setMaLength] = useState(20);
  const [maType, setMaType] = useState<MaType>("SMA");
  const [smoothingLength, setSmoothingLength] = useState(9);
  resolutionRef.current = resolution;
  maSettingsRef.current = { length: maLength, type: maType, smoothingLength };
  const [lastPrice, setLastPrice] = useState<string>("N/A");

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
        scaleMargins: { top: 0.08, bottom: 0.10 },
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

      // Neo cạnh phải và chỉ thay đổi vùng nhìn về phía trái
      event.preventDefault();

      const range = currentChart.timeScale().getVisibleLogicalRange();
      if (!range) return;

      const currentWidth = range.to - range.from;
      const factor = event.deltaY > 0 ? 1.07 : 1 / 1.07;
      const nextWidth = Math.max(8, Math.min(300, currentWidth * factor));
      const rightEdge = range.to;

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
      series.setData(bars);
      const volumeBars = bars.filter((bar) => isVolumeSessionTime(bar.time));
      volumeSeriesRef.current?.setData(volumeBars.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color: bar.close >= bar.open ? "rgba(99, 200, 155, 0.55)" : "rgba(223, 95, 104, 0.55)",
      })));
      const settings = maSettingsRef.current;
      volumeSmaSeriesRef.current?.setData(volumeMa(volumeBars, settings.length, settings.type, settings.smoothingLength));
      if (bars.length) timelineSeriesRef.current?.setData(futureTimelinePoints(Number(bars[bars.length - 1].time), resolution));
      barsByTimeRef.current = new Map(bars.map((bar) => [Number(bar.time), bar]));
      previousCloseByTimeRef.current = new Map(bars.slice(1).map((bar, index) => [Number(bar.time), bars[index].close]));
      const visibleBars = INITIAL_VISIBLE_BARS[resolution] ?? 30;

      // Gọi lại sau khi kích thước biểu đồ ổn định để tránh nến bị nén
      const focusLatestBars = () => {
        if (cancelled) return;

        if (rangeDays !== undefined) {
          // Chế độ đặt sẵn hiển thị toàn bộ dữ liệu đã tải
          chart.timeScale().fitContent();
        } else if (bars.length > visibleBars) {
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, bars.length - visibleBars),
            to: bars.length + 6,
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
      if (bars.length) {
        currentBarRef.current = bars[bars.length - 1];
        setLastPrice(currentBarRef.current.close.toFixed(2));
        setVisibleBar(currentBarRef.current);
      }
    })();

    const refreshVolumeMa = () => {
      const allBars = [...barsByTimeRef.current.values()]
        .filter((bar) => isVolumeSessionTime(bar.time))
        .sort((a, b) => Number(a.time) - Number(b.time));
      const settings = maSettingsRef.current;
      volumeSmaSeriesRef.current?.setData(
        volumeMa(allBars, settings.length, settings.type, settings.smoothingLength)
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
          if (isVolumeSessionTime(reconciled.time)) {
            volumeSeriesRef.current?.update({
              time: reconciled.time,
              value: reconciled.volume,
              color: reconciled.close >= reconciled.open
                ? "rgba(99, 200, 155, 0.55)"
                : "rgba(223, 95, 104, 0.55)",
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
        const isNewBucket = lastRealtimeBucketRef.current !== bucketNumber;

        currentBarRef.current = mergeTick(currentBarRef.current, tick.price, tick.volume, bucket);
        lastRealtimeBucketRef.current = bucketNumber;
        if (isNewBucket) timelineSeriesRef.current?.setData(futureTimelinePoints(bucketNumber, resolution));

        seriesRef.current?.update(currentBarRef.current);
        if (isVolumeSessionTime(currentBarRef.current.time)) {
          volumeSeriesRef.current?.update({
            time: currentBarRef.current.time,
            value: currentBarRef.current.volume,
            color: currentBarRef.current.close >= currentBarRef.current.open
              ? "rgba(99, 200, 155, 0.55)"
              : "rgba(223, 95, 104, 0.55)",
          });
        }
        barsByTimeRef.current.set(bucketNumber, currentBarRef.current);

        if (isVolumeSessionTime(currentBarRef.current.time)) {
          const allBars = [...barsByTimeRef.current.values()]
            .filter((bar) => isVolumeSessionTime(bar.time))
            .sort((a, b) => Number(a.time) - Number(b.time));
          const settings = maSettingsRef.current;
          const latestVolumeSma = volumeMa(allBars, settings.length, settings.type, settings.smoothingLength).at(-1);
          if (latestVolumeSma) volumeSmaSeriesRef.current?.update(latestVolumeSma);
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
      .filter((bar) => isVolumeSessionTime(bar.time))
      .sort((a, b) => Number(a.time) - Number(b.time));
    volumeSmaSeriesRef.current?.setData(volumeMa(bars, maLength, maType, smoothingLength));
  }, [maLength, maType, smoothingLength]);

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
  const sortedBars = [...barsByTimeRef.current.values()].sort((a, b) => Number(a.time) - Number(b.time));
  const currentVolumeMa = volumeMa(sortedBars, maLength, maType, smoothingLength).at(-1)?.value;

  const applyRangePreset = (preset: (typeof RANGE_PRESETS)[number]) => {
    setRangeDays(preset.days);
  };

  return (
    <div id="app">
      <header>
        <div className="symbol-row">
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
          <div className="engine-switch" role="group" aria-label="Chart engine">
            <button className="engine-switch--active">Lightweight</button>
            <button onClick={onSelectKLine}>KLineChart</button>
          </div>
        </div>
        <div className="status-row">
          <span className={"dot " + (status === "connected" ? "dot--on" : "dot--off")} />
          <span>{status}</span>
          <span id="last-price">{lastPrice}</span>
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
            <label className="ma-control" title="Volume MA settings">
              MA
              <input type="number" min="2" max="500" value={maLength} aria-label="MA length" onChange={(event) => setMaLength(Math.max(2, Math.min(500, Number(event.target.value) || 2)))} />
              <select value={maType} onChange={(event) => setMaType(event.target.value as MaType)} aria-label="MA type">
                <option value="SMA">SMA</option>
                <option value="EMA">EMA</option>
                <option value="WMA">WMA</option>
              </select>
              <input type="number" min="1" max="500" value={smoothingLength} aria-label="Smoothing length" onChange={(event) => setSmoothingLength(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
            </label>
          </div>
          <div className="indicator-data-row">
            <span className="indicator-data__name">Khối lượng {maLength} {maType} {smoothingLength}</span>
            <span className="indicator-data__volume">{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</span>
            <span className="indicator-data__ma">{currentVolumeMa !== undefined ? formatVolume(currentVolumeMa) : "N/A"}</span>
            <span className="indicator-data__actions" title="Volume indicator controls">◉ ⚙ × ···</span>
          </div>
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
