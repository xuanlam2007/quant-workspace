"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  type ILineToolsPlugin,
  type LineToolExport,
  type LineToolType,
} from "lightweight-charts-line-tools-core";
import {
  fetchHistory,
  fetchSymbolInfo,
  mergeBars,
  symbolPriceFormat,
  type Bar,
  type SymbolInfo,
} from "@/lib/dchart-api";
import { connectPriceFeed, type ConnStatus, type PriceTick } from "@/lib/dchart-socket";
import { bucketStart, mergeTick } from "@/lib/bar-builder";
import { createRealtimeTickBuffer } from "@/lib/realtime-tick-buffer";
import { ChartFooter } from "./chart/layout/ChartFooter";
import { ChartHeader } from "./chart/layout/ChartHeader";
import { MarketDataPanel } from "./chart/layout/MarketDataPanel";
import { DrawingToolbar } from "./chart/drawing/DrawingToolbar";
import { DrawingPropertiesToolbar } from "./chart/drawing/DrawingPropertiesToolbar";
import { DrawingAxisRangeHighlight } from "./chart/drawing/DrawingAxisRangeHighlight";
import { PriceRangeStats } from "./chart/drawing/PriceRangeStats";
import { TextToolDialog } from "./chart/drawing/TextToolDialog";
import { createDrawingTools } from "./chart/drawing/chart-drawing";
import {
  drawingPreset,
  normalizeDrawingState,
  priceRangeAppearance,
} from "./chart/drawing/drawing-presets";
import {
  DEFAULT_VISIBLE_BARS,
  PRICE_INDICATORS,
  SYMBOLS,
  type MaType,
  type RangePreset,
  type ScaleMode,
  type StudyId,
} from "./chart/config/chart-config";
import { bollingerData, macdData, priceIndicatorData, rsiData, volumeMa } from "./chart/indicators/chart-indicators";
import {
  candleColor,
  drawingStorageKey,
  formatChartTime,
  futureTimelinePoints,
  isTradingSessionTime,
  rangeForResolution,
  volumeColor,
} from "./chart/core/chart-utils";
import { useIndicatorSettings } from "./chart/indicators/useIndicatorSettings";
import { DelayedTooltip } from "./chart/ui/DelayedTooltip";
import { OutsideDragSelectionGuard } from "./chart/ui/OutsideDragSelectionGuard";

const tickFormatters = new Map<string, Intl.DateTimeFormat>();
const DRAWING_HISTORY_VERSION = 1;
const MAX_DRAWING_HISTORY_STATES = 100;

type StoredDrawingHistory = {
  version: typeof DRAWING_HISTORY_VERSION;
  undo: string[];
  redo: string[];
};

function isDrawingState(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
}

function formatTick(time: Time, resolution: string, timezone: string) {
  const isDaily = ["D", "W", "M"].includes(resolution);
  const key = `${timezone}:${isDaily ? "daily" : "intraday"}`;
  let formatter = tickFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", isDaily
      ? { timeZone: timezone, day: "2-digit", month: "short" }
      : { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
    tickFormatters.set(key, formatter);
  }
  return formatter.format(new Date(Number(time) * 1000));
}

function drawingHistoryStorageKey(drawingKey: string) {
  return `${drawingKey}:history`;
}

function latestVolumeMaPoint(
  bars: Bar[],
  length: number,
  type: MaType,
  smoothingLength: number,
) {
  return volumeMa(bars, length, type, smoothingLength).at(-1);
}

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
  const realtimeTickHandlerRef = useRef<(tick: PriceTick) => void>(() => undefined);
  const lastRealtimeBucketRef = useRef<number | undefined>(undefined);
  const drawingKeyRef = useRef("");
  const drawingHistoryRef = useRef<string[]>(["[]"]);
  const drawingRedoHistoryRef = useRef<string[]>([]);
  const resolutionRef = useRef("D");
  const symbolTimezoneRef = useRef("Asia/Bangkok");
  const maSettingsRef = useRef<{ length: number; type: MaType; smoothingLength: number }>({ length: 20, type: "SMA", smoothingLength: 9 });
  const drawingGestureRef = useRef(false);
  const activeDrawingToolRef = useRef<LineToolType | null>(null);
  const stayInDrawingModeRef = useRef(false);
  const eraserModeRef = useRef(false);
  const hiddenDrawingsRef = useRef<string | null>(null);
  const autoScaleRef = useRef(true);
  const flushRealtimeRef = useRef<() => void>(() => undefined);
  const loadOlderHistoryRef = useRef<() => void>(() => undefined);
  const lastRenderedRealtimeBucketRef = useRef<number | undefined>(undefined);
  const lastCandleColorRef = useRef<string | undefined>(undefined);
  const panGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    captureTarget: Element;
  } | null>(null);

  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [resolvedSymbol, setResolvedSymbol] = useState<{ symbol: string; info: SymbolInfo }>();
  const [resolution, setResolution] = useState("D");
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [activeDrawingTool, setActiveDrawingTool] = useState<LineToolType | null>(null);
  const [eraserMode, setEraserMode] = useState(false);
  const [magnetMode, setMagnetMode] = useState<0 | 1 | 2>(0);
  const [stayInDrawingMode, setStayInDrawingMode] = useState(false);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<LineToolExport<LineToolType> | null>(null);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [editingTextDrawing, setEditingTextDrawing] = useState<LineToolExport<LineToolType> | null>(null);
  const textDialogOpenRef = useRef(false);
  textDialogOpenRef.current = textDialogOpen;
  const [drawingViewportVersion, setDrawingViewportVersion] = useState(0);
  const [visibleBar, setVisibleBar] = useState<Bar | undefined>(undefined);
  const [rangeDays, setRangeDays] = useState<number | undefined>(undefined);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("normal");
  const [autoScale, setAutoScale] = useState(true);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false);
  const [symbolSearchInitialQuery, setSymbolSearchInitialQuery] = useState("");
  const [dataError, setDataError] = useState<string>();
  const [chartTimezone, setChartTimezone] = useState("Asia/Bangkok");
  const symbolInfo = resolvedSymbol?.symbol === symbol ? resolvedSymbol.info : undefined;

  const handleTimezoneChange = useCallback((newTimezone: string) => {
    setChartTimezone(newTimezone);
  }, []);

  const effectiveChartTimezone = chartTimezone === "exchange"
    ? symbolInfo?.timezone ?? "Asia/Bangkok"
    : chartTimezone;

  useEffect(() => {
    symbolTimezoneRef.current = effectiveChartTimezone;
    chartRef.current?.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, effectiveChartTimezone),
      },
    });
  }, [effectiveChartTimezone]);

  const syncDrawingHistoryAvailability = useCallback(() => {
    setCanUndo(drawingHistoryRef.current.length > 1);
    setCanRedo(drawingRedoHistoryRef.current.length > 0);
  }, []);

  const persistDrawingHistory = useCallback(() => {
    if (!drawingKeyRef.current) return;
    const history: StoredDrawingHistory = {
      version: DRAWING_HISTORY_VERSION,
      undo: drawingHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES),
      redo: drawingRedoHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES),
    };
    localStorage.setItem(
      drawingHistoryStorageKey(drawingKeyRef.current),
      JSON.stringify(history),
    );
  }, []);

  const recordDrawingState = useCallback((drawingState: string) => {
    if (drawingHistoryRef.current.at(-1) !== drawingState) {
      drawingHistoryRef.current.push(drawingState);
      drawingHistoryRef.current = drawingHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
      drawingRedoHistoryRef.current = [];
    }
    if (drawingKeyRef.current) {
      localStorage.setItem(drawingKeyRef.current, drawingState);
    }
    persistDrawingHistory();
    syncDrawingHistoryAvailability();
  }, [persistDrawingHistory, syncDrawingHistoryAvailability]);

  const restoreDrawingState = useCallback((drawingState: string) => {
    const lineTools = lineToolsRef.current;
    if (!lineTools) return;
    lineTools.removeAllLineTools();
    if (drawingState !== "[]") lineTools.importLineTools(drawingState);
    setSelectedDrawing(null);
    if (drawingKeyRef.current) {
      localStorage.setItem(drawingKeyRef.current, drawingState);
    }
    persistDrawingHistory();
  }, [persistDrawingHistory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        setSymbolSearchInitialQuery(e.key.toUpperCase());
        setIsSymbolModalOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
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
  symbolTimezoneRef.current = effectiveChartTimezone;
  maSettingsRef.current = { length: maLength, type: maType, smoothingLength };
  autoScaleRef.current = autoScale;
  activeDrawingToolRef.current = activeDrawingTool;
  stayInDrawingModeRef.current = stayInDrawingMode;
  eraserModeRef.current = eraserMode;
  textDialogOpenRef.current = textDialogOpen;

  useEffect(() => {
    const controller = new AbortController();
    setDataError(undefined);
    setVisibleBar(undefined);
    currentBarRef.current = undefined;
    barsByTimeRef.current.clear();
    previousCloseByTimeRef.current.clear();
    seriesRef.current?.setData([]);
    volumeSeriesRef.current?.setData([]);
    volumeSmaSeriesRef.current?.setData([]);
    timelineSeriesRef.current?.setData([]);
    fetchSymbolInfo(symbol, controller.signal)
      .then((info) => setResolvedSymbol({ symbol, info }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDataError(error instanceof Error ? error.message : "symbol metadata failed");
      });
    return () => controller.abort();
  }, [symbol]);

  const openTextDialog = useCallback((drawing: LineToolExport<LineToolType>) => {
    setEditingTextDrawing(drawing);
    setTextDialogOpen(true);
  }, []);

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
        attributionLogo: false,
      },
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, symbolTimezoneRef.current),
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
      rightPriceScale: {
        visible: true,
        borderColor: "#262b38",
        scaleMargins: { top: 0.02, bottom: 0 },
      },
      defaultVisiblePriceScaleId: "left",
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
        tickMarkFormatter: (time: Time) => formatTick(
          time,
          resolutionRef.current,
          symbolTimezoneRef.current,
        ),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      autoSize: true,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "right",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const volumeSmaSeries = chart.addSeries(LineSeries, {
      color: "rgba(4, 150, 255, 0.5)",
      lineWidth: 3,
      lineType: LineType.Simple,
      priceScaleId: "right",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const series = chart.addSeries(CandlestickSeries, {
      priceScaleId: "left",
      upColor: "#54BA88",
      downColor: "#EB4D5C",
      borderVisible: false,
      wickUpColor: "#54BA88",
      wickDownColor: "#EB4D5C",
      priceLineVisible: true,
      priceLineColor: "#EB4D5C",
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    const timelineSeries = chart.addSeries(LineSeries, {
      priceScaleId: "",
      lineVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale("right").applyOptions({
      // Giữ biểu đồ khối lượng trong vùng chính như VNDirect
      scaleMargins: { top: 0.02, bottom: 0 },
      visible: true,
      autoScale: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    volumeSmaSeriesRef.current = volumeSmaSeries;
    timelineSeriesRef.current = timelineSeries;

    chart.subscribeCrosshairMove((param) => {
      if (panGestureRef.current?.active) return;
      const time = param.time ? Number(param.time) : undefined;
      setVisibleBar(time ? barsByTimeRef.current.get(time) : currentBarRef.current);
    });

    const lineTools = createDrawingTools(chart, series);
    lineTools.setMagnetThreshold(0);
    const persistDrawingState = () => {
      recordDrawingState(lineTools.exportLineTools());
    };
    lineTools.subscribeLineToolsAfterEdit((event) => {
      let selectedLineTool = event.selectedLineTool;
      const appearance = priceRangeAppearance(selectedLineTool);
      if (appearance) {
        selectedLineTool = { ...selectedLineTool, options: appearance as typeof selectedLineTool.options };
        lineTools.applyLineToolOptions(selectedLineTool);
      }
      setSelectedDrawing(selectedLineTool);
      persistDrawingState();
      if (event.stage !== "lineToolFinished") return;

      if (selectedLineTool.toolType === "Text") {
        openTextDialog(selectedLineTool);
      }

      const currentTool = activeDrawingToolRef.current;
      if (stayInDrawingModeRef.current && currentTool) {
        requestAnimationFrame(() => {
          drawingGestureRef.current = true;
          lineTools.addLineTool(currentTool, undefined, drawingPreset(currentTool));
        });
        return;
      }

      drawingGestureRef.current = false;
      activeDrawingToolRef.current = null;
      setActiveDrawingTool(null);
    });
    lineTools.subscribeLineToolsSingleClick((event) => {
      if (textDialogOpenRef.current) return;
      if (event.selectionState === "deselected") {
        setSelectedDrawing(null);
        return;
      }
      if (eraserModeRef.current) {
        lineTools.removeLineToolsById([event.selectedLineTool.id]);
        setSelectedDrawing(null);
        persistDrawingState();
        return;
      }
      if (event.selectedLineTool.points && event.selectedLineTool.options) {
        setSelectedDrawing(event.selectedLineTool as LineToolExport<LineToolType>);
      }
    });
    lineTools.subscribeLineToolsDoubleClick((event) => {
      setSelectedDrawing(event.selectedLineTool);
      if (event.selectedLineTool.toolType === "Text") openTextDialog(event.selectedLineTool);
    });
    const refreshDrawingOverlays = (range?: { from: number; to: number } | null) => {
      setDrawingViewportVersion((current) => current + 1);
      if (range && Number(range.from) <= 20) loadOlderHistoryRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshDrawingOverlays);
    lineToolsRef.current = lineTools;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const selectedTools = lineToolsRef.current?.getSelectedLineTools();
      if (drawingGestureRef.current || (selectedTools && selectedTools !== "[]")) {
        chart.applyOptions({ handleScroll: { pressedMouseMove: false } });
        return;
      }

      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const leftScaleWidth = chart.priceScale("left").width();
      const rightScaleWidth = chart.priceScale("right").width();
      if (x <= leftScaleWidth || x >= rect.width - rightScaleWidth || y >= chart.paneSize().height) return;

      const priceRange = chart.priceScale("left").getVisibleRange();
      if (!priceRange) return;
      const captureTarget = event.target instanceof Element ? event.target : element;
      chart.priceScale("left").setVisibleRange(priceRange);

      panGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        captureTarget,
      };
      captureTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const gesture = panGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (!gesture.active && event.clientX === gesture.startX && event.clientY === gesture.startY) return;

      gesture.active = true;
      autoScaleRef.current = false;
    };

    const finishPan = (event: PointerEvent) => {
      const gesture = panGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      panGestureRef.current = null;
      if (gesture.active) {
        setAutoScale(false);
        flushRealtimeRef.current();
      }
      if (gesture.captureTarget.hasPointerCapture(event.pointerId)) gesture.captureTarget.releasePointerCapture(event.pointerId);
    };

    const onAxisWheel = (event: WheelEvent) => {
      const element = containerRef.current;
      if (!element || event.deltaY === 0) return;

      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const leftScale = chart.priceScale("left");
      const rightScale = chart.priceScale("right");
      const scale = pointerX <= leftScale.width()
        ? leftScale
        : pointerX >= rect.width - rightScale.width()
          ? rightScale
          : null;
      if (!scale) return;

      const range = scale.getVisibleRange();
      if (!range) return;
      const height = Math.max(1, chart.paneSize().height);
      const pointerY = Math.max(0, Math.min(height, event.clientY - rect.top));
      const startPoint = height - pointerY;
      const targetPoint = Math.max(0, startPoint - 15 * Math.sign(event.deltaY));
      const padding = (height - 1) * 0.2;
      const scaleFactor = Math.max((startPoint + padding) / (targetPoint + padding), 0.1);
      const center = (Number(range.from) + Number(range.to)) / 2;
      const halfRange = ((Number(range.to) - Number(range.from)) * scaleFactor) / 2;

      scale.setVisibleRange({ from: center - halfRange, to: center + halfRange });
      refreshDrawingOverlays();
      if (scale === leftScale) {
        autoScaleRef.current = false;
        setAutoScale(false);
      }
      event.preventDefault();
      event.stopPropagation();
    };

    const element = containerRef.current;
    if (!element) return;
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", finishPan);
    element.addEventListener("pointercancel", finishPan);
    element.addEventListener("wheel", onAxisWheel, { capture: true, passive: false });

    // Đồng bộ kích thước biểu đồ và plugin ngay từ lần bố trí đầu tiên
    const syncChartSize = () => {
      const element = containerRef.current;
      if (!element) return;
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      if (width > 0 && height > 0) {
        chart.resize(width, height);
        refreshDrawingOverlays();
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncChartSize);
    });
    resizeObserver.observe(containerRef.current);
    requestAnimationFrame(syncChartSize);

    return () => {
      panGestureRef.current = null;
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", finishPan);
      element.removeEventListener("pointercancel", finishPan);
      element.removeEventListener("wheel", onAxisWheel, true);
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(refreshDrawingOverlays);
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
  }, [recordDrawingState]);

  // Tải lịch sử và kết nối lại dữ liệu trực tiếp khi mã hoặc khung thời gian đổi
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !symbolInfo) return;
    const activeSession = symbolInfo.session;
    const activeTimezone = symbolInfo.timezone;
    const activePriceFormat = symbolPriceFormat(symbolInfo);

    let cancelled = false;
    let loadingOlderHistory = false;
    let olderHistoryExhausted = false;
    const historyAbortController = new AbortController();
    loadOlderHistoryRef.current = () => undefined;
    setDataError(undefined);
    series.applyOptions({ priceFormat: activePriceFormat });
    const realtimeTickBuffer = createRealtimeTickBuffer<PriceTick>(
      (tick) => Number(bucketStart(tick.time, resolution)),
    );
    currentBarRef.current = undefined;
    drawingKeyRef.current = drawingStorageKey(symbol, resolution);
    hiddenDrawingsRef.current = null;
    setDrawingsHidden(false);
    setSelectedDrawing(null);
    setTextDialogOpen(false);
    setEditingTextDrawing(null);
    lineToolsRef.current?.removeAllLineTools();

    (async () => {
      const { from, to } = rangeForResolution(resolution, rangeDays);
      let bars: Bar[] = [];
      try {
        bars = await fetchHistory(
          symbol,
          resolution,
          from,
          to,
          historyAbortController.signal,
        );
      } catch (error: unknown) {
        if (cancelled || historyAbortController.signal.aborted) return;
        realtimeTickBuffer.dispose();
        series.setData([]);
        volumeSeriesRef.current?.setData([]);
        volumeSmaSeriesRef.current?.setData([]);
        timelineSeriesRef.current?.setData([]);
        barsByTimeRef.current.clear();
        previousCloseByTimeRef.current.clear();
        currentBarRef.current = undefined;
        setVisibleBar(undefined);
        setDataError(error instanceof Error ? error.message : "history fetch failed");
        return;
      }
      if (cancelled) return;
      const chartBars = bars.filter((bar) => isTradingSessionTime(
        bar.time,
        resolution,
        activeSession,
        activeTimezone,
      ));
      series.setData(chartBars);
      if (chartBars.length) {
        const color = candleColor(chartBars[chartBars.length - 1]);
        series.applyOptions({ priceLineColor: color });
        lastCandleColorRef.current = color;
        lastRenderedRealtimeBucketRef.current = Number(chartBars[chartBars.length - 1].time);
      }
      const volumeBars = chartBars;
      volumeSeriesRef.current?.setData(volumeBars.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color: volumeColor(bar),
      })));
      chart.priceScale("right").setAutoScale(true);
      const settings = maSettingsRef.current;
      volumeSmaSeriesRef.current?.setData(volumeMa(
        volumeBars,
        settings.length,
        settings.type,
        settings.smoothingLength,
      ));
      updateStudySeries(chartBars);
      if (chartBars.length) timelineSeriesRef.current?.setData(futureTimelinePoints(Number(chartBars[chartBars.length - 1].time), resolution));
      barsByTimeRef.current = new Map(chartBars.map((bar) => [Number(bar.time), bar]));
      previousCloseByTimeRef.current = new Map(chartBars.slice(1).map((bar, index) => [Number(bar.time), chartBars[index].close]));
      let earliestHistoryTime = chartBars[0] ? Number(chartBars[0].time) : undefined;
      const historyWindowSeconds = Math.max(86400, to - from);

      loadOlderHistoryRef.current = () => {
        if (cancelled || loadingOlderHistory || olderHistoryExhausted || earliestHistoryTime === undefined) return;
        loadingOlderHistory = true;
        const pageTo = earliestHistoryTime - 1;
        const pageFrom = pageTo - historyWindowSeconds;
        const visibleRange = chart.timeScale().getVisibleRange();

        void fetchHistory(symbol, resolution, pageFrom, pageTo, historyAbortController.signal)
          .then((olderBars) => {
            if (cancelled) return;
            const filteredOlderBars = olderBars.filter((bar) => (
              isTradingSessionTime(bar.time, resolution, activeSession, activeTimezone)
            ));
            if (filteredOlderBars.length === 0) {
              olderHistoryExhausted = true;
              return;
            }

            const existingBars = [...barsByTimeRef.current.values()];
            const mergedBars = mergeBars(existingBars, filteredOlderBars);
            if (mergedBars.length === existingBars.length) {
              olderHistoryExhausted = true;
              return;
            }

            barsByTimeRef.current = new Map(mergedBars.map((bar) => [Number(bar.time), bar]));
            previousCloseByTimeRef.current = new Map(
              mergedBars.slice(1).map((bar, index) => [Number(bar.time), mergedBars[index].close]),
            );
            earliestHistoryTime = Number(mergedBars[0].time);
            series.setData(mergedBars);
            volumeSeriesRef.current?.setData(mergedBars.map((bar) => ({
              time: bar.time,
              value: bar.volume,
              color: volumeColor(bar),
            })));
            const currentSettings = maSettingsRef.current;
            volumeSmaSeriesRef.current?.setData(volumeMa(
              mergedBars,
              currentSettings.length,
              currentSettings.type,
              currentSettings.smoothingLength,
            ));
            updateStudySeries(mergedBars);
            if (visibleRange) chart.timeScale().setVisibleRange(visibleRange);
            setDataError(undefined);
          })
          .catch((error: unknown) => {
            if (cancelled || historyAbortController.signal.aborted) return;
            setDataError(error instanceof Error ? error.message : "older history fetch failed");
          })
          .finally(() => {
            loadingOlderHistory = false;
          });
      };
      const visibleBars = DEFAULT_VISIBLE_BARS;

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

        chart.priceScale("left").setAutoScale(true);
      };

      focusLatestBars();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          focusLatestBars();
          if (!autoScaleRef.current) {
            const priceScale = chart.priceScale("left");
            const priceRange = priceScale.getVisibleRange();
            if (priceRange) priceScale.setVisibleRange(priceRange);
            else priceScale.setAutoScale(false);
          }
        });
      });
      const savedDrawings = localStorage.getItem(drawingKeyRef.current);
      const normalizedDrawings = savedDrawings
        ? normalizeDrawingState(savedDrawings)
        : "[]";
      if (savedDrawings) {
        lineToolsRef.current?.importLineTools(normalizedDrawings);
        if (normalizedDrawings !== savedDrawings) {
          localStorage.setItem(drawingKeyRef.current, normalizedDrawings);
        }
      }
      const fallbackUndo = normalizedDrawings === "[]"
        ? ["[]"]
        : ["[]", normalizedDrawings];
      let restoredUndo = fallbackUndo;
      let restoredRedo: string[] = [];
      const storedHistory = localStorage.getItem(
        drawingHistoryStorageKey(drawingKeyRef.current),
      );
      if (storedHistory) {
        try {
          const parsedHistory = JSON.parse(storedHistory) as Partial<StoredDrawingHistory>;
          const undo = Array.isArray(parsedHistory.undo)
            ? parsedHistory.undo.filter(isDrawingState).map(normalizeDrawingState)
            : [];
          const redo = Array.isArray(parsedHistory.redo)
            ? parsedHistory.redo.filter(isDrawingState).map(normalizeDrawingState)
            : [];
          if (
            parsedHistory.version === DRAWING_HISTORY_VERSION
            && undo.length > 0
            && undo.at(-1) === normalizedDrawings
          ) {
            restoredUndo = undo.slice(-MAX_DRAWING_HISTORY_STATES);
            restoredRedo = redo.slice(-MAX_DRAWING_HISTORY_STATES);
          }
        } catch {
          localStorage.removeItem(drawingHistoryStorageKey(drawingKeyRef.current));
        }
      }
      drawingHistoryRef.current = restoredUndo;
      drawingRedoHistoryRef.current = restoredRedo;
      persistDrawingHistory();
      syncDrawingHistoryAvailability();
      if (chartBars.length) {
        currentBarRef.current = chartBars[chartBars.length - 1];
        lastRealtimeBucketRef.current = Number(currentBarRef.current.time);
        setLastPrice(currentBarRef.current.close.toFixed(activePriceFormat.precision));
        setVisibleBar(currentBarRef.current);
      }
      realtimeTickBuffer.release(
        currentBarRef.current ? Number(currentBarRef.current.time) : undefined,
        processRealtimeTick,
      );
    })();

    const refreshVolumeMa = () => {
      const allBars = [...barsByTimeRef.current.values()]
        .filter((bar) => isTradingSessionTime(bar.time, resolution, activeSession, activeTimezone))
        .sort((a, b) => Number(a.time) - Number(b.time));
      const settings = maSettingsRef.current;
      volumeSmaSeriesRef.current?.setData(
        volumeMa(allBars, settings.length, settings.type, settings.smoothingLength)
      );
    };

    const currentBar = currentBarRef.current as Bar | undefined;
    lastRealtimeBucketRef.current = currentBar
      ? Number(currentBar.time)
      : undefined;

    const renderRealtimeBar = (bar: Bar) => {
      const bucketNumber = Number(bar.time);
      const isNewRenderedBucket = lastRenderedRealtimeBucketRef.current !== bucketNumber;
      if (isNewRenderedBucket) timelineSeriesRef.current?.setData(futureTimelinePoints(bucketNumber, resolution));

      seriesRef.current?.update(bar);
      const color = candleColor(bar);
      if (color !== lastCandleColorRef.current) {
        seriesRef.current?.applyOptions({ priceLineColor: color });
        lastCandleColorRef.current = color;
      }
      volumeSeriesRef.current?.update({
        time: bar.time,
        value: bar.volume,
        color: volumeColor(bar),
      });

      const allBars = [...barsByTimeRef.current.values()];
      const currentSettings = maSettingsRef.current;
      const latestVolumeSma = latestVolumeMaPoint(
        allBars,
        currentSettings.length,
        currentSettings.type,
        currentSettings.smoothingLength,
      );
      if (latestVolumeSma) volumeSmaSeriesRef.current?.update(latestVolumeSma);
      if (priceIndicatorSeriesRef.current.size > 0 || macdSeriesRef.current || rsiSeriesRef.current) {
        updateStudySeries(allBars);
      }

      lastRenderedRealtimeBucketRef.current = bucketNumber;
      setLastPrice(bar.close.toFixed(activePriceFormat.precision));
      setVisibleBar(bar);
    };

    flushRealtimeRef.current = () => {
      const bar = currentBarRef.current;
      if (bar) renderRealtimeBar(bar);
    };

    function processRealtimeTick(tick: PriceTick) {
      const bucket = bucketStart(tick.time, resolution);
      const bucketNumber = Number(bucket);
      if (!isTradingSessionTime(bucket, resolution, activeSession, activeTimezone)) {
        if (!panGestureRef.current?.active) setLastPrice(tick.price.toFixed(activePriceFormat.precision));
        return;
      }
      const isNewBucket = lastRealtimeBucketRef.current !== bucketNumber;
      const previousBar = currentBarRef.current;
      if (previousBar && bucketNumber < Number(previousBar.time)) return;
      if (isNewBucket && previousBar) {
        previousCloseByTimeRef.current.set(bucketNumber, previousBar.close);
      }

      currentBarRef.current = mergeTick(currentBarRef.current, tick.price, tick.volume, bucket);
      lastRealtimeBucketRef.current = bucketNumber;
      barsByTimeRef.current.set(bucketNumber, currentBarRef.current);
      if (!panGestureRef.current?.active) renderRealtimeBar(currentBarRef.current);
    }

    realtimeTickHandlerRef.current = (tick) => {
      realtimeTickBuffer.push(tick, processRealtimeTick);
    };

    return () => {
      cancelled = true;
      historyAbortController.abort();
      realtimeTickBuffer.dispose();
      loadOlderHistoryRef.current = () => undefined;
      realtimeTickHandlerRef.current = () => undefined;
      flushRealtimeRef.current = () => undefined;
    };
  }, [persistDrawingHistory, rangeDays, resolution, symbol, symbolInfo, syncDrawingHistoryAvailability]);

  useEffect(() => {
    const feed = connectPriceFeed(
      symbol,
      (tick) => realtimeTickHandlerRef.current(tick),
      setStatus,
    );
    feedRef.current = feed;

    return () => {
      feed.close();
      if (feedRef.current === feed) feedRef.current = null;
    };
  }, [symbol]);

  useEffect(() => {
    const bars = [...barsByTimeRef.current.values()]
      .filter((bar) => isTradingSessionTime(
        bar.time,
        resolution,
        symbolInfo?.session,
        symbolInfo?.timezone,
      ))
      .sort((a, b) => Number(a.time) - Number(b.time));
    volumeSmaSeriesRef.current?.setData(volumeMa(bars, maLength, maType, smoothingLength));
  }, [maLength, maType, resolution, smoothingLength, symbolInfo?.session, symbolInfo?.timezone]);

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
      .filter((bar) => isTradingSessionTime(
        bar.time,
        resolution,
        symbolInfo?.session,
        symbolInfo?.timezone,
      ))
      .sort((a, b) => Number(a.time) - Number(b.time));
    updateStudySeries(bars);
  }, [activeStudies, resolution, symbolInfo?.session, symbolInfo?.timezone]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const priceScale = chartRef.current?.priceScale("left");
    if (!priceScale) return;
    priceScale.applyOptions({
      mode: scaleMode === "percent" ? PriceScaleMode.Percentage : scaleMode === "log" ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
    priceScale.setAutoScale(autoScale);
  }, [autoScale, scaleMode]);

  useEffect(() => {
    lineToolsRef.current?.setLocked(drawingsLocked);
  }, [drawingsLocked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const beforeDelete = lineToolsRef.current?.exportLineTools();
        lineToolsRef.current?.removeSelectedLineTools();
        if (lineToolsRef.current) {
          const drawingState = lineToolsRef.current.exportLineTools();
          if (beforeDelete !== drawingState) recordDrawingState(drawingState);
        }
      }
      const modifierPressed = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifierPressed && key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (drawingHistoryRef.current.length > 1) {
          const currentState = drawingHistoryRef.current.pop()!;
          drawingRedoHistoryRef.current.push(currentState);
          drawingRedoHistoryRef.current = drawingRedoHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
          restoreDrawingState(drawingHistoryRef.current.at(-1) ?? "[]");
          syncDrawingHistoryAvailability();
        }
      }
      if (modifierPressed && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        const nextState = drawingRedoHistoryRef.current.pop();
        if (nextState) {
          drawingHistoryRef.current.push(nextState);
          drawingHistoryRef.current = drawingHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
          restoreDrawingState(nextState);
          syncDrawingHistoryAvailability();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recordDrawingState, restoreDrawingState, syncDrawingHistoryAvailability]);

  const startDrawing = (type: LineToolType) => {
    if (drawingsLocked || !lineToolsRef.current) return;
    if (drawingsHidden && hiddenDrawingsRef.current) {
      lineToolsRef.current.importLineTools(hiddenDrawingsRef.current);
      hiddenDrawingsRef.current = null;
      setDrawingsHidden(false);
    }
    drawingGestureRef.current = true;
    activeDrawingToolRef.current = type;
    eraserModeRef.current = false;
    setActiveDrawingTool(type);
    setEraserMode(false);
    lineToolsRef.current.addLineTool(type, undefined, drawingPreset(type));
  };

  const selectCursor = () => {
    const lineTools = lineToolsRef.current;
    drawingGestureRef.current = false;
    activeDrawingToolRef.current = null;
    eraserModeRef.current = false;
    setActiveDrawingTool(null);
    setEraserMode(false);
    if (lineTools) {
      lineTools.setLocked(true);
      lineTools.setLocked(drawingsLocked);
    }
    chartRef.current?.applyOptions({ handleScroll: { pressedMouseMove: true } });
  };

  const selectEraser = () => {
    selectCursor();
    eraserModeRef.current = true;
    setEraserMode(true);
  };

  const toggleMagnet = () => {
    setMagnetMode((current) => {
      const next = ((current + 1) % 3) as 0 | 1 | 2;
      lineToolsRef.current?.setMagnetThreshold(next === 0 ? 0 : next === 1 ? 10 : 24);
      return next;
    });
  };

  const toggleDrawingLock = () => {
    if (!drawingsLocked) selectCursor();
    setDrawingsLocked((locked) => !locked);
  };

  const toggleDrawingsVisibility = () => {
    const lineTools = lineToolsRef.current;
    if (!lineTools) return;
    selectCursor();
    if (drawingsHidden) {
      if (hiddenDrawingsRef.current) lineTools.importLineTools(hiddenDrawingsRef.current);
      hiddenDrawingsRef.current = null;
      setDrawingsHidden(false);
      return;
    }

    hiddenDrawingsRef.current = lineTools.exportLineTools();
    lineTools.removeAllLineTools();
    setDrawingsHidden(true);
  };

  const zoomInChart = () => {
    const timeScale = chartRef.current?.timeScale();
    const range = timeScale?.getVisibleLogicalRange();
    if (!timeScale || !range) return;
    const center = (range.from + range.to) / 2;
    const halfSpan = (range.to - range.from) * 0.4;
    timeScale.setVisibleLogicalRange({ from: center - halfSpan, to: center + halfSpan });
  };

  const clearDrawings = () => {
    lineToolsRef.current?.removeAllLineTools();
    hiddenDrawingsRef.current = null;
    setDrawingsHidden(false);
    recordDrawingState("[]");
    if (drawingKeyRef.current) localStorage.removeItem(drawingKeyRef.current);
  };

  const clearIndicators = () => setActiveStudies([]);

  const clearChartObjects = () => {
    clearDrawings();
    clearIndicators();
  };

  const persistCurrentDrawings = () => {
    const lineTools = lineToolsRef.current;
    if (!lineTools) return;
    recordDrawingState(lineTools.exportLineTools());
  };

  const updateSelectedDrawing = (drawing: LineToolExport<LineToolType>) => {
    if (!lineToolsRef.current?.applyLineToolOptions(drawing)) return;
    setSelectedDrawing(drawing);
    persistCurrentDrawings();
  };

  const toggleSelectedDrawingLock = () => {
    if (!selectedDrawing) return;
    updateSelectedDrawing({
      ...selectedDrawing,
      options: { ...selectedDrawing.options, editable: selectedDrawing.options.editable === false } as typeof selectedDrawing.options,
    });
  };

  const deleteSelectedDrawingById = () => {
    if (!selectedDrawing || !lineToolsRef.current) return;
    lineToolsRef.current.removeLineToolsById([selectedDrawing.id]);
    setSelectedDrawing(null);
    persistCurrentDrawings();
  };

  const quoteBar = visibleBar ?? currentBarRef.current;
  const previousClose = quoteBar ? previousCloseByTimeRef.current.get(Number(quoteBar.time)) : undefined;
  const currentPriceFormat = symbolInfo
    ? symbolPriceFormat(symbolInfo)
    : { type: "price" as const, precision: 2, minMove: 0.01 };
  const sortedBars = [...barsByTimeRef.current.values()]
    .filter((bar) => isTradingSessionTime(
      bar.time,
      resolution,
      symbolInfo?.session,
      symbolInfo?.timezone,
    ))
    .sort((a, b) => Number(a.time) - Number(b.time));
  const currentVolumeMa = volumeMa(sortedBars, maLength, maType, smoothingLength).at(-1)?.value;
  const drawingToolbarAnchor = (() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const chartElement = containerRef.current;
    if (!selectedDrawing || !chart || !series || !chartElement) return null;
    const coordinates = selectedDrawing.points.flatMap((point) => {
      const x = chart.timeScale().timeToCoordinate(point.timestamp as Time);
      const y = series.priceToCoordinate(point.price);
      return x === null || y === null ? [] : [{ x, y: chartElement.offsetTop + y }];
    });
    if (!coordinates.length) return null;
    const xValues = coordinates.map((point) => point.x);
    const yValues = coordinates.map((point) => point.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    const isTextBearingTool = selectedDrawing.toolType === "Text" || selectedDrawing.toolType === "Callout";
    let textAnchor: { x: number; y: number } | undefined;
    if (isTextBearingTool) {
      const targetPoint = selectedDrawing.toolType === "Callout" && selectedDrawing.points.length > 1
        ? selectedDrawing.points[1]
        : selectedDrawing.points[0];
      const targetX = chart.timeScale().timeToCoordinate(targetPoint.timestamp as Time);
      const targetY = series.priceToCoordinate(targetPoint.price);
      if (targetX !== null && targetY !== null) {
        textAnchor = { x: targetX, y: chartElement.offsetTop + targetY };
      }
    }

    return {
      centerX: (minX + maxX) / 2,
      top: minY,
      bottom: maxY,
      left: minX,
      right: maxX,
      textAnchor,
    };
  })();

  const applyRangePreset = (preset?: RangePreset) => {
    setRangeDays(preset?.days);
    if (preset) setResolution(preset.resolution);
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

  const handleUndo = useCallback(() => {
    if (drawingHistoryRef.current.length <= 1 || !lineToolsRef.current) return;
    const currentState = drawingHistoryRef.current.pop()!;
    drawingRedoHistoryRef.current.push(currentState);
    drawingRedoHistoryRef.current = drawingRedoHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
    const prevState = drawingHistoryRef.current.at(-1) ?? "[]";
    restoreDrawingState(prevState);
    syncDrawingHistoryAvailability();
  }, [restoreDrawingState, syncDrawingHistoryAvailability]);

  const handleRedo = useCallback(() => {
    if (drawingRedoHistoryRef.current.length === 0 || !lineToolsRef.current) return;
    const nextState = drawingRedoHistoryRef.current.pop()!;
    drawingHistoryRef.current.push(nextState);
    drawingHistoryRef.current = drawingHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
    restoreDrawingState(nextState);
    syncDrawingHistoryAvailability();
  }, [restoreDrawingState, syncDrawingHistoryAvailability]);

  return (
    <div id="app">
      <DelayedTooltip />
      <OutsideDragSelectionGuard />
      <ChartHeader
        symbol={symbol}
        resolution={resolution}
        timeframeMenuOpen={timeframeMenuOpen}
        indicatorMenuOpen={indicatorMenuOpen}
        indicatorSearch={indicatorSearch}
        activeStudies={activeStudies}
        maDescription={`${maLength} ${maType} ${smoothingLength}`}
        isFullscreen={isFullscreen}
        connectionStatus={status}
        canUndo={canUndo}
        canRedo={canRedo}
        isSymbolModalOpen={isSymbolModalOpen}
        initialSearchQuery={symbolSearchInitialQuery}
        onSymbolModalToggle={(open) => {
          setIsSymbolModalOpen(open);
          if (!open) setSymbolSearchInitialQuery("");
        }}
        onSymbolChange={(nextSymbol) => {
          setSymbol(nextSymbol);
          setIsSymbolModalOpen(false);
          setSymbolSearchInitialQuery("");
        }}
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
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <div className="chart-shell">
        <DrawingToolbar
          activeTool={activeDrawingTool}
          eraserMode={eraserMode}
          locked={drawingsLocked}
          magnetMode={magnetMode}
          stayInDrawingMode={stayInDrawingMode}
          drawingsHidden={drawingsHidden}
          onSelectCursor={selectCursor}
          onSelectEraser={selectEraser}
          onStartDrawing={startDrawing}
          onToggleMagnet={toggleMagnet}
          onToggleStayInDrawingMode={() => setStayInDrawingMode((enabled) => !enabled)}
          onToggleLock={toggleDrawingLock}
          onToggleVisibility={toggleDrawingsVisibility}
          onZoomIn={zoomInChart}
          onClear={clearDrawings}
          onClearIndicators={clearIndicators}
          onClearAll={clearChartObjects}
        />
        <div className="chart-stage">
          <MarketDataPanel
            symbol={symbol}
            exchange={symbolInfo?.exchange ?? ""}
            pricePrecision={currentPriceFormat.precision}
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
          <main
            id="chart"
            ref={containerRef}
            className={activeDrawingTool || eraserMode ? "chart--tool-active" : "chart--pan"}
          />
          {dataError && <div className="chart-data-error" role="alert">{dataError}</div>}
          {selectedDrawing && chartRef.current && seriesRef.current && (
            <DrawingAxisRangeHighlight
              drawing={selectedDrawing}
              chart={chartRef.current}
              series={seriesRef.current}
              chartTop={containerRef.current?.offsetTop ?? 40}

              viewportVersion={drawingViewportVersion}
            />
          )}
          {selectedDrawing && (
            <DrawingPropertiesToolbar
              drawing={selectedDrawing}
              anchor={drawingToolbarAnchor}
              onChange={updateSelectedDrawing}
              onOpenSettings={() => {
                if (selectedDrawing.toolType === "Text") openTextDialog(selectedDrawing);
              }}
              onToggleLock={toggleSelectedDrawingLock}
              onDelete={deleteSelectedDrawingById}
            />
          )}
          {selectedDrawing?.toolType === "PriceRange" && chartRef.current && seriesRef.current && (
            <PriceRangeStats
              drawing={selectedDrawing}
              chart={chartRef.current}
              series={seriesRef.current}
              chartTop={containerRef.current?.offsetTop ?? 40}
              bars={sortedBars}
              viewportVersion={drawingViewportVersion}
            />
          )}
          <ChartFooter
            rangeDays={rangeDays}
            scaleMode={scaleMode}
            autoScale={autoScale}
            timezone={chartTimezone}
            exchangeTimezone={symbolInfo?.timezone}
            onRangeChange={applyRangePreset}
            onScaleModeChange={setScaleMode}
            onAutoScaleToggle={() => setAutoScale((enabled) => !enabled)}
            onTimezoneChange={handleTimezoneChange}
          />
        </div>
      </div>
      {editingTextDrawing?.toolType === "Text" && textDialogOpen && (
        <TextToolDialog
          text={editingTextDrawing.options.text}
          onCancel={() => {
            setTextDialogOpen(false);
            setEditingTextDrawing(null);
          }}
          onConfirm={(text) => {
            const updated = {
              ...editingTextDrawing,
              options: { ...editingTextDrawing.options, text } as typeof editingTextDrawing.options,
            };
            updateSelectedDrawing(updated);
            setTextDialogOpen(false);
            setEditingTextDrawing(null);
          }}
        />
      )}
    </div>
  );
}
