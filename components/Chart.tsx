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
import { ChartFooter } from "./chart/ChartFooter";
import { ChartHeader } from "./chart/ChartHeader";
import { DrawingToolbar } from "./chart/DrawingToolbar";
import { MarketDataPanel } from "./chart/MarketDataPanel";
import {
  INITIAL_VISIBLE_BARS,
  PRICE_INDICATORS,
  SYMBOLS,
  type MaType,
  type RangePreset,
  type ScaleMode,
  type StudyId,
} from "./chart/chart-config";
import { bollingerData, macdData, priceIndicatorData, rsiData, volumeMa } from "./chart/chart-indicators";
import {
  candleColor,
  drawingStorageKey,
  formatChartTime,
  futureTimelinePoints,
  isTradingSessionTime,
  rangeForResolution,
  volumeColor,
} from "./chart/chart-utils";
import { useIndicatorSettings } from "./chart/useIndicatorSettings";

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
  const [scaleMode, setScaleMode] = useState<ScaleMode>("normal");
  const [autoScale, setAutoScale] = useState(true);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const {
    activeStudies,
    setActiveStudies,
    maLength,
    setMaLength,
    maType,
    setMaType,
    smoothingLength,
    setSmoothingLength,
  } = useIndicatorSettings();
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

  const deleteSelectedDrawing = () => {
    const beforeDelete = lineToolsRef.current?.exportLineTools();
    lineToolsRef.current?.removeSelectedLineTools();
    const drawingState = lineToolsRef.current?.exportLineTools();
    if (drawingState && drawingState !== beforeDelete) drawingHistoryRef.current.push(drawingState);
  };

  const quoteBar = visibleBar ?? currentBarRef.current;
  const previousClose = quoteBar ? previousCloseByTimeRef.current.get(Number(quoteBar.time)) : undefined;
  const sortedBars = [...barsByTimeRef.current.values()]
    .filter((bar) => isTradingSessionTime(bar.time, resolution))
    .sort((a, b) => Number(a.time) - Number(b.time));
  const currentVolumeMa = volumeMa(sortedBars, maLength).at(-1)?.value;

  const applyRangePreset = (preset?: RangePreset) => {
    setRangeDays(preset?.days);
  };

  const toggleStudy = (id: StudyId) => {
    setActiveStudies((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

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
      <ChartHeader
        symbol={symbol}
        resolution={resolution}
        status={status}
        lastPrice={lastPrice}
        timeframeMenuOpen={timeframeMenuOpen}
        indicatorMenuOpen={indicatorMenuOpen}
        indicatorSearch={indicatorSearch}
        activeStudies={activeStudies}
        maDescription={`${maLength} ${maType} ${smoothingLength}`}
        isFullscreen={isFullscreen}
        onSymbolChange={setSymbol}
        onResolutionChange={(nextResolution) => {
          setRangeDays(undefined);
          setResolution(nextResolution);
          setTimeframeMenuOpen(false);
        }}
        onTimeframeMenuToggle={setTimeframeMenuOpen}
        onIndicatorMenuToggle={setIndicatorMenuOpen}
        onIndicatorSearchChange={setIndicatorSearch}
        onStudyToggle={toggleStudy}
        onDownloadSnapshot={downloadSnapshot}
        onToggleFullscreen={toggleFullscreen}
      />
      <div className="chart-shell">
        <DrawingToolbar
          locked={drawingsLocked}
          onStartDrawing={startDrawing}
          onUndo={undoDrawings}
          onToggleLock={() => setDrawingsLocked((locked) => !locked)}
          onDeleteSelected={deleteSelectedDrawing}
          onClear={clearDrawings}
        />
        <div className="chart-stage">
          <MarketDataPanel
            symbol={symbol}
            resolution={resolution}
            quoteBar={quoteBar}
            previousClose={previousClose}
            volumeEnabled={activeStudies.includes("volume")}
            currentVolumeMa={currentVolumeMa}
            maLength={maLength}
            maType={maType}
            smoothingLength={smoothingLength}
            onMaLengthChange={setMaLength}
            onMaTypeChange={setMaType}
            onSmoothingLengthChange={setSmoothingLength}
          />
          <main id="chart" ref={containerRef} />
          <ChartFooter
            rangeDays={rangeDays}
            scaleMode={scaleMode}
            autoScale={autoScale}
            onRangeChange={applyRangePreset}
            onScaleModeChange={setScaleMode}
            onAutoScaleToggle={() => setAutoScale((enabled) => !enabled)}
          />
        </div>
      </div>
    </div>
  );
}
