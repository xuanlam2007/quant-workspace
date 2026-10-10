"use client";

import { LoadingIndicator } from "./ui/Loading";
import { useCallback, useEffect, useRef, useState } from "react";
import { createChartRenderScheduler } from "@/lib/chart-render-scheduler";
import { createQuoteStore, LiveMarketData } from "./chart/layout/symbols/LiveMarketData";
import { StreamingIndicators } from "./chart/indicators/streaming-indicators";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  PriceScaleMode,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type IPriceScaleApi,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";
import {
  interpolateLogicalIndexFromTime,
  logicalIndexToCoordinate,
  type ILineToolsPlugin,
  type LineToolExport,
  type LineToolPartialOptionsMap,
  type LineToolType,
} from "lightweight-charts-line-tools-core";
import {
  fetchHistory as fetchMarketHistory,
  fetchSymbolInfo,
  mergeBars,
  symbolPriceFormat,
  type Bar,
  type SymbolInfo,
} from "@/lib/dchart-api";
import type { ChartReplay, ReplayDrawing } from "@/lib/backtest";
import { connectPriceFeed, type ConnStatus, type PriceTick } from "@/lib/dchart-socket";
import { bucketStart, mergeTick } from "@/lib/bar-builder";
import { createRealtimeTickBuffer } from "@/lib/realtime-tick-buffer";
import {
  bundlePriceWheelRange,
  bundleTimeWheelRange,
  bundleWheelDelta,
  selectedZoomRange,
  type WheelState,
} from "./chart/core/chart-zoom";
import { PaneControls } from "./chart/layout/panes/PaneControls";
import type { PanePresentation } from "./chart/layout/panes/pane-presentation";
import { ChangeIntervalDialog } from "./chart/layout/navigation/ChangeIntervalDialog";
import { GoToDateDialog } from "./chart/layout/navigation/GoToDateDialog";
import { ChartFooter } from "./chart/layout/navigation/ChartFooter";
import { PriceAxisContextMenu, type PriceAxisMenuAction, type PriceAxisMenuState } from "./chart/layout/panes/PriceAxisContextMenu";
import { ChartContextMenu, type ChartMenuAction, type ChartMenuPosition } from "./chart/layout/panes/ChartContextMenu";
import { PriceAxisScaleButton, type ScaleButtonTarget } from "./chart/layout/panes/PriceAxisScaleButton";
import { ScrollToLatestButton } from "./chart/layout/navigation/ScrollToLatestButton";
import { AppHeader } from "./AppHeader";
import { ChartHeader } from "./chart/layout/navigation/ChartHeader";
import { activateNamedLayout, captureWorkspace } from "./chart/layout/workspace/named-layouts";
import { ChartStyleRenderer } from "./chart/core/chart-style-renderer";
import { chartStudyBars, defaultStyleSettings, readChartStylePreferences, saveChartStylePreferences, type ChartStylePreferences } from "./chart/config/chart-styles";
import { MarketDataPanel, type ComparisonQuote, type SourceLegend } from "./chart/layout/symbols/MarketDataPanel";
import type { VolumeSettings } from "./chart/layout/settings/VolumeSettingsDialog";
import { ChartSettingsDialog, DEFAULT_CHART_APPEARANCE, type ChartAppearance } from "./chart/layout/settings/ChartSettingsDialog";
import { DrawingToolbar } from "./chart/drawing/DrawingToolbar";
import { DRAWING_HISTORY_VERSION, MAX_DRAWING_HISTORY_STATES, drawingHistoryDay, restoreDrawingHistory, type StoredDrawingHistory } from "./chart/drawing/drawing-history";
import { DrawingPropertiesToolbar } from "./chart/drawing/DrawingPropertiesToolbar";
import { DrawingAxisRangeHighlight } from "./chart/drawing/DrawingAxisRangeHighlight";
import { PriceRangeStats } from "./chart/drawing/PriceRangeStats";
import { priceNoteSettings, priceNoteVisible, type PriceNoteOptions } from "./chart/drawing/price-note-options";
import { PriceNoteDialog } from "./chart/drawing/PriceNoteDialog";
import { TextToolDialog } from "./chart/drawing/TextToolDialog";
import { createDrawingTools } from "./chart/drawing/chart-drawing";
import {
  drawingPreset,
  saveDrawingDefaults,
  normalizeDrawingState,
  priceRangeAppearance,
} from "./chart/drawing/drawing-presets";
import {
  DEFAULT_RESOLUTION,
  DEFAULT_SYMBOL,
  DEFAULT_VISIBLE_BARS,
  DRAWING_TOOL_GROUPS,
  COMPARE_SYMBOLS_STORAGE_KEY,
  RECENT_COMPARE_SYMBOLS_STORAGE_KEY,
  PRICE_INDICATORS,
  RESOLUTION_STORAGE_KEY,
  SYMBOL_STORAGE_KEY,
  normalizeStoredCompareSymbols,
  normalizeStoredRecentCompareSymbols,
  normalizeStoredSymbol,
  normalizeStoredResolution,
  type MaType,
  type RangePreset,
  type ScaleMode,
  type StudyId,
} from "./chart/config/chart-config";
import { bollingerData, macdData, priceIndicatorData, rsiData, volumeMa } from "./chart/indicators/chart-indicators";
import {
  barCloseCountdown,
  alignComparisonPoints,
  comparisonValueAt,
  drawingStorageKey,
  formatChartTime,
  futureTimelinePoints,
  isTradingSessionTime,
  rangeForResolution,
} from "./chart/core/chart-utils";
import { useReferenceStudies, type ReferenceSeries } from "./chart/indicators/useReferenceStudies";
import { ReferenceStudySettingsDialog } from "./chart/layout/settings/ReferenceStudySettingsDialog";
import { ComparisonSettingsDialog } from "./chart/layout/settings/ComparisonSettingsDialog";
import { ReferenceStudyView } from "./chart/indicators/ReferenceStudyView";
import { COMPARISON_DEFINITION, comparisonAllowed, comparisonPlotPoint, comparisonPoints, comparisonPriceFormat, comparisonReferenceSettings, normalizeComparisonSettings, type ComparisonSettings } from "./chart/config/comparison-settings";
import { formatVolume } from "./chart/core/chart-utils";
import { useIndicatorSettings } from "./chart/indicators/useIndicatorSettings";
import { readSaved, writeSaved, useSavedState } from "./chart/config/saved-state";
import { useSavedLayout } from "./chart/layout/workspace/useSavedLayout";
import { DelayedTooltip } from "./chart/ui/DelayedTooltip";
import { OutsideDragSelectionGuard } from "./chart/ui/OutsideDragSelectionGuard";
import { readAxisSettings, writeAxisSettings, readManualAxisRange, writeManualAxisRange } from "./chart/config/axis-settings";

const tickFormatters = new Map<string, Intl.DateTimeFormat>();
const COMPARE_COLORS = ["#F57C00", "#2962ff", "#ab47bc", "#26a69a", "#ef5350"];

function safePriceScaleWidth(chart: IChartApi, side: "left" | "right", paneIndex: number) {
  try {
    return chart.priceScale(side, paneIndex).width();
  } catch {
    return 0;
  }
}

function logarithmicPriceRange(scale: IPriceScaleApi, range: { from: number; to: number }) {
  const internal = scale as IPriceScaleApi & { _private__priceScale?: () => { _internal_getLogFormula: () => { _internal_logicalOffset: number; _internal_coordOffset: number } } };
  const formula = internal._private__priceScale?.()._internal_getLogFormula();
  const offset = formula?._internal_logicalOffset ?? (range.to - range.from >= 1 ? 4 : 4 + Math.ceil(Math.abs(Math.log10(range.to - range.from))));
  const coordinateOffset = formula?._internal_coordOffset ?? 10 ** -offset;
  const toLog = (price: number) => Math.abs(price) < 1e-15 ? 0 : Math.sign(price) * (Math.log10(Math.abs(price) + coordinateOffset) + offset);
  return { from: toLog(range.from), to: toLog(range.to) };
}

function setVisiblePriceRange(scale: IPriceScaleApi, range: { from: number; to: number }) {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) return;
  if (scale.options().mode === PriceScaleMode.Percentage || scale.options().mode === PriceScaleMode.IndexedTo100) {
    scale.setAutoScale(true);
    return;
  }
  // API nhận tọa độ logarit dù getVisibleRange trả về giá gốc.
  scale.setVisibleRange(scale.options().mode === PriceScaleMode.Logarithmic ? logarithmicPriceRange(scale, range) : range);
}

function refreshPriceScaleData(chart: IChartApi, scale: IPriceScaleApi) {
  // Nạp lại dữ liệu hiện có để tính lại thang giá và tọa độ qua API công khai.
  const source = chart.panes().flatMap((pane) => pane.getSeries())
    .find((series) => series.priceScale().options() === scale.options() && series.data().length > 0);
  if (source) source.setData([...source.data()]);
  scale.getVisibleRange();
}

function applyPriceScaleMode(chart: IChartApi, scale: IPriceScaleApi, mode: PriceScaleMode) {
  const previous = scale.options().mode;
  const wasAutoScale = scale.options().autoScale;
  const relativeMode = mode === PriceScaleMode.Percentage || mode === PriceScaleMode.IndexedTo100;
  const preserve = !wasAutoScale
    && (previous === PriceScaleMode.Normal || previous === PriceScaleMode.Logarithmic)
    && (mode === PriceScaleMode.Normal || mode === PriceScaleMode.Logarithmic);
  const range = preserve ? scale.getVisibleRange() : null;

  scale.applyOptions({ mode });
  if (previous !== mode) {
    scale.setAutoScale(true);
    refreshPriceScaleData(chart, scale);
    scale.setAutoScale(relativeMode || wasAutoScale);
  }
  if (range) setVisiblePriceRange(scale, range);
}

function installVisibleCandleOpenAsPercentReference(series: ISeriesApi<"Candlestick">) {
  type InternalCandle = { _internal_time: number; _internal_value: number[] };
  type InternalSeries = {
    _internal_firstBar: () => InternalCandle | null;
    _internal_firstValue: () => { _internal_value: number; _internal_timePoint: number } | null;
    _internal_priceScale: () => { _internal_isPercentage: () => boolean; _internal_isIndexedTo100: () => boolean };
  };
  const internal = (series as unknown as { _internal__series?: InternalSeries })._internal__series;
  if (!internal) return;
  const originalFirstValue = internal._internal_firstValue.bind(internal);

  // VNDIRECT dùng giá mở cửa của nến đầu tiên hiển thị làm mốc phần trăm.
  internal._internal_firstValue = () => {
    const scale = internal._internal_priceScale();
    if (!scale._internal_isPercentage() && !scale._internal_isIndexedTo100()) return originalFirstValue();
    const firstBar = internal._internal_firstBar();
    return firstBar === null
      ? null
      : { _internal_value: firstBar._internal_value[0], _internal_timePoint: firstBar._internal_time };
  };
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

export default function Chart({ active = true, replay }: { active?: boolean; replay?: ChartReplay }) {
  const [generation, setGeneration] = useState(0);
  const loadLayout = useCallback((id: string) => {
    activateNamedLayout(id);
    setGeneration((value) => value + 1);
  }, []);
  return <div id={replay ? "backtest-chart-app" : "app"}><ChartInstance key={`${generation}-${replay ? "replay" : "live"}`} active={active} replay={replay} onLoadLayout={loadLayout}/></div>;
}

function ChartInstance({ active, onLoadLayout, replay }: { active: boolean; onLoadLayout: (id: string) => void; replay?: ChartReplay }) {
  const replayRef = useRef(replay);
  replayRef.current = replay;
  const replayMode = !!replay;
  const replayCutoff = replay?.frame?.cutoff;
  const replayFrame = replay?.frame;
  const replaySession = replay?.session;
  const onReplayReady = replay?.onReady;
  const fetchHistory = useCallback(async (requestedSymbol: string, requestedResolution: string, from: number, to: number, signal?: AbortSignal): Promise<Bar[]> => {
    const current = replayRef.current;
    if (!current) return fetchMarketHistory(requestedSymbol, requestedResolution, from, to, signal);
    signal?.throwIfAborted();
    const frame = current.frame;
    if (!frame || requestedResolution !== "1") return [];
    if (requestedSymbol === current.symbol) return frame.bars.filter(bar => bar.time >= from && bar.time <= to).map(bar => ({ ...bar, time: bar.time as Bar["time"] }));
    const start = Math.max(from, frame.bars[0]?.time ?? frame.cutoff);
    const end = Math.min(to, frame.cutoff - 60);
    if (end <= start) return [];
    const bars = await fetchMarketHistory(requestedSymbol, "1", start, end, signal);
    const cutoff = Math.min(frame.cutoff, replayRef.current?.frame?.cutoff ?? 0);
    return bars.filter(bar => Number(bar.time) + 60 <= cutoff);
  }, []);
  const [documentVisible, setDocumentVisible] = useState(true);
  const activeRef = useRef(active);
  activeRef.current = active && !replay?.busy;
  const renderingRef = useRef(active && documentVisible);
  renderingRef.current = active && documentVisible;
  const suspendRealtimeRef = useRef<() => void>(() => undefined);
  const pendingComparisonQuotesRef = useRef(new Map<string, ComparisonQuote>());
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const chartStyleRendererRef = useRef<ChartStyleRenderer | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumeMaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const mainSelectionMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSelectionMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const refreshSelectionMarkersRef = useRef<() => void>(() => undefined);
  const compareSeriesRef = useRef(new Map<string, ReferenceSeries>());
  const compareViewsRef = useRef(new Map<string, ReferenceStudyView>());
  const compareRawBarsRef = useRef(new Map<string, Bar[]>());
  const compareInfoRef = useRef(new Map<string, SymbolInfo>());
  const compareHiddenRef = useRef(new Set<string>());
  const compareIntervalAllowedRef = useRef(new Map<string, boolean>());
  const comparisonSettingsRef = useRef<Record<string, ComparisonSettings>>({});
  const compareBarsRef = useRef(new Map<string, { time: Bar["time"]; value: number }[]>());
  const sourceScaleOverridesRef = useRef(new Map<string, "left" | "right">());
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
  const highLowLinesRef = useRef<{ high: IPriceLine; low: IPriceLine } | null>(null);
  const refreshHighLowRef = useRef<(bar?: Bar) => void>(() => undefined);
  const mainScaleSideRef = useRef<"left" | "right">("right");
  const mainPaneIndexRef = useRef(0);
  const previousMainScaleSideRef = useRef<"left" | "right">("right");
  const indicatorScaleSidesRef = useRef<{ macd: "left" | "right"; rsi: "left" | "right" }>({ macd: "right", rsi: "right" });
  const scaleRatioRef = useRef<number | null>(null);
  const scaleLockedRef = useRef(false);
  const lineToolsRef = useRef<ILineToolsPlugin | null>(null);
  const currentBarRef = useRef<Bar | undefined>(undefined);
  const hoveredMainSeriesRef = useRef<{ x: number; y: number; paneIndex: number } | null>(null);
  const barsByTimeRef = useRef(new Map<number, Bar>());
  const previousCloseByTimeRef = useRef(new Map<number, number>());
  const syncCompareSeries = useCallback(() => {
    const mainTimes = [...barsByTimeRef.current.keys()].sort((a, b) => a - b) as Bar["time"][];
    compareSeriesRef.current.forEach((series, compareSymbol) => {
      series.setData(alignComparisonPoints(compareBarsRef.current.get(compareSymbol) ?? [], mainTimes).map(comparisonPlotPoint));
    });
  }, []);
  const updateCompareSeries = useCallback((time: Bar["time"]) => {
    compareSeriesRef.current.forEach((series, compareSymbol) => {
      const value = comparisonValueAt(compareBarsRef.current.get(compareSymbol) ?? [], time);
      series.update(comparisonPlotPoint({ time, value }));
    });
  }, []);
  const feedRef = useRef<ReturnType<typeof connectPriceFeed> | null>(null);
  const realtimeTickHandlerRef = useRef<(tick: PriceTick) => void>(() => undefined);
  const lastRealtimeBucketRef = useRef<number | undefined>(undefined);
  const drawingKeyRef = useRef("");
  const drawingHistoryRef = useRef<string[]>(["[]"]);
  const drawingRedoHistoryRef = useRef<string[]>([]);
  const drawingHistoryDayRef = useRef("");
  const exchangeTimezoneRef = useRef("Asia/Bangkok");
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
  const panGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    captureTarget: Element;
  } | null>(null);
  const zoomModeRef = useRef(false);
  const zoomStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    plotLeft: number;
    plotRight: number;
    plotTop: number;
    plotHeight: number;
  } | null>(null);
  const zoomHistoryRef = useRef<{
    leftOffset: number;
    rightOffset: number;
    barSpacing: number;
    priceRange: { from: number; to: number } | null;
    priceScaleMode: PriceScaleMode;
    autoScale: boolean;
    followLatest: boolean;
  }[]>([]);
  const followLatestRef = useRef(true);
  const viewportInteractionRef = useRef(0);
  const historyLoadGenerationRef = useRef(0);
  const preloadedHistoryRef = useRef<{
    symbol: string;
    resolution: string;
    rangeDays: number | undefined;
    promise: Promise<Bar[]>;
  } | null>(null);

  const [selectedSymbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const symbol = replay?.symbol ?? selectedSymbol;
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [comparisonSettings, setComparisonSettings] = useState<Record<string, ComparisonSettings>>({});
  const [comparisonSettingsRestored, setComparisonSettingsRestored] = useState(false);
  useEffect(() => {
    const saved = readSaved<Record<string, unknown>>("chart.comparisonSettings.v1");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      setComparisonSettings(Object.fromEntries(Object.entries(saved).map(([symbol, settings]) => [symbol, normalizeComparisonSettings(settings)])));
    }
    setComparisonSettingsRestored(true);
  }, []);
  useEffect(() => {
    if (comparisonSettingsRestored) writeSaved("chart.comparisonSettings.v1", comparisonSettings);
  }, [comparisonSettings, comparisonSettingsRestored]);
  comparisonSettingsRef.current = comparisonSettings;
  const [comparisonSettingsSymbol, setComparisonSettingsSymbol] = useState<string | null>(null);
  const [recentCompareSymbols, setRecentCompareSymbols] = useState<string[]>([]);
  const [resolvedSymbol, setResolvedSymbol] = useState<{ symbol: string; info: SymbolInfo }>();
  const [symbolRestored, setSymbolRestored] = useState(false);
  const [selectedResolution, setResolution] = useState(DEFAULT_RESOLUTION);
  const resolution = replayMode ? "1" : selectedResolution;
  const [resolutionRestored, setResolutionRestored] = useState(false);
  const [intervalQuery, setIntervalQuery] = useState<string | null>(null);
  const [goToDateRange, setGoToDateRange] = useState<{ from: number; to: number } | null>(null);
  const dateNavigationControllerRef = useRef<AbortController | null>(null);
  const navigateHistoryRef = useRef<(from: number, to?: number) => Promise<void>>(async () => { throw new Error("Dữ liệu đang tải, vui lòng thử lại"); });
  const crosshairDrawingPointRef = useRef<{ timestamp: number; price: number } | null>(null);
  const openGoToDate = useCallback(() => {
    if (replayRef.current) return;
    const range = chartRef.current?.timeScale().getVisibleRange();
    const bars = [...barsByTimeRef.current.values()];
    const from = bars.find((bar) => !range || Number(bar.time) >= Number(range.from));
    const to = bars.findLast((bar) => !range || Number(bar.time) <= Number(range.to));
    const now = Date.now() / 1000;
    setGoToDateRange({ from: Number(from?.time ?? now), to: Number(to?.time ?? now) });
  }, []);
  const closeGoToDate = useCallback(() => {
    dateNavigationControllerRef.current?.abort();
    dateNavigationControllerRef.current = null;
    setGoToDateRange(null);
  }, []);
  useEffect(() => {
    closeGoToDate();
    return () => dateNavigationControllerRef.current?.abort();
  }, [symbol, resolution, closeGoToDate]);
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [drawingsLocked, setDrawingsLocked] = useSavedState("chart.drawingsLocked.v1", false);
  const [activeDrawingTool, setActiveDrawingTool] = useState<LineToolType | null>(null);
  const [eraserMode, setEraserMode] = useState(false);
  const [magnetMode, setMagnetMode] = useSavedState<0 | 1 | 2>("chart.magnetMode.v1", 0);
  const [stayInDrawingMode, setStayInDrawingMode] = useSavedState("chart.stayInDrawingMode.v1", false);
  const [drawingsHidden, setDrawingsHidden] = useSavedState("chart.drawingsHidden.v1", false);
  const drawingsHiddenRef = useRef(drawingsHidden);
  drawingsHiddenRef.current = drawingsHidden;
  const [selectedDrawing, setSelectedDrawing] = useState<LineToolExport<LineToolType> | null>(null);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [editingTextDrawing, setEditingTextDrawing] = useState<LineToolExport<LineToolType> | null>(null);
  const textDialogOpenRef = useRef(false);
  textDialogOpenRef.current = textDialogOpen;
  const [drawingViewportVersion, setDrawingViewportVersion] = useState(0);
  const [quoteStore] = useState(createQuoteStore);
  const setVisibleBar = quoteStore.set;
  const [comparisonQuotes, setComparisonQuotes] = useState<ComparisonQuote[]>([]);
  const [mainSeriesVisible, setMainSeriesVisible] = useSavedState("chart.mainVisible.v1", true);
  const [rangeDays, setRangeDays] = useState<number | undefined>(undefined);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("normal");
  const [axisSettingsRestored, setAxisSettingsRestored] = useState(false);
  const loadedAxisContextRef = useRef<string | null>(null);
  const [scaleSideOverride, setScaleSideOverride] = useState<"left" | "right" | null>(null);
  const [indicatorScaleSideOverrides, setIndicatorScaleSideOverrides] = useState<{ macd: "left" | "right" | null; rsi: "left" | "right" | null }>({ macd: null, rsi: null });
  const [scaleLocked, setScaleLocked] = useState(false);
  const [seriesOnlyScale, setSeriesOnlyScale] = useState(false);
  const [axisLabels, setAxisLabels] = useState({ symbol: true, seriesValue: true, highLow: false, studyNames: false, studyValues: false, align: true });
  const [axisLines, setAxisLines] = useState({ price: true, highLow: false });
  const [countdownVisible, setCountdownVisible] = useState(false);
  const [countdown, setCountdown] = useState<{ text: string; top: number } | null>(null);
  const [axisMenu, setAxisMenu] = useState<PriceAxisMenuState | null>(null);
  const [chartMenu, setChartMenu] = useState<ChartMenuPosition | null>(null);
  const [crosshairLocked, setCrosshairLocked] = useState(false);
  const lockedCrosshairRef = useRef<{ time: Bar["time"]; price: number; series: ISeriesApi<"Candlestick"> | ISeriesApi<"Histogram"> | ISeriesApi<"Line"> } | null>(null);
  const [marksHidden, setMarksHidden] = useSavedState("chart.hideMarksOnBars", false);
  const [hoverAxis, setHoverAxis] = useState<{ side: "left" | "right"; paneIndex: number; left: number; top: number; width: number } | null>(null);
  const [footerAxis, setFooterAxis] = useState<{ side: "left" | "right"; paneIndex: number } | null>(null);
  const [autoScale, setAutoScale] = useState(true);
  const drawingClipboardRef = useRef<string | null>(null);
  const [zoomMode, setZoomMode] = useState(false);
  const [zoomHistoryCount, setZoomHistoryCount] = useState(0);
  const [zoomSelection, setZoomSelection] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [symbolSearchInitialQuery, setSymbolSearchInitialQuery] = useState("");
  const [dataError, setDataError] = useState<string>();
  const [historyLoading, setHistoryLoading] = useState(true);
  const [olderHistoryLoading, setOlderHistoryLoading] = useState(false);
  const [comparisonStatus, setComparisonStatus] = useState<Record<string, "loading" | "ready" | "error">>({});
  const [chartTimezone, setChartTimezone] = useSavedState("chart.timezone.v1", "Asia/Bangkok");
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const [volumeMaVisible, setVolumeMaVisible] = useSavedState("chart.volumeMaVisible.v1", false);
  const [selectedLegend, setSelectedLegend] = useState<string | null>(null);
  const [volumeHidden, setVolumeHidden] = useSavedState("chart.volumeHidden.v1", false);
  const [volumePaneIndex, setVolumePaneIndex] = useState(0);
  const [volumeScaleSideOverride, setVolumeScaleSideOverride] = useState<"left" | "right" | null>(null);
  const [volumeSmoothedMaVisible, setVolumeSmoothedMaVisible] = useSavedState("chart.volumeSmoothingVisible.v1", false);
  const [volumeVisualSettings, setVolumeVisualSettings, volumeSettingsRestored] = useSavedState("chart.volumeAppearance.v1", {
    colorByPreviousClose: false,
    histogramVisible: true,
    upColor: "#53B987",
    downColor: "#eb4d5c",
    maColor: "#2196f3",
    smoothedColor: "#2196f3",
    maPlotStyle: "line" as VolumeSettings["maPlotStyle"],
    smoothedPlotStyle: "line" as VolumeSettings["smoothedPlotStyle"],
    maPriceLineVisible: false,
    smoothedPriceLineVisible: false,
    scaleLabelVisible: false,
    statusValueVisible: true,
    visibleIntervals: [true, true, true, true, true],
  });
  const volumeVisualSettingsRef = useRef(volumeVisualSettings);
  volumeVisualSettingsRef.current = volumeVisualSettings;
  const volumeColorForBar = useCallback((bar: Bar, previousClose?: number) => {
    const settings = volumeVisualSettingsRef.current;
    const growing = bar.close >= (settings.colorByPreviousClose && previousClose !== undefined ? previousClose : bar.open);
    const color = growing ? settings.upColor : settings.downColor;
    const alpha = /^#[\da-f]{8}$/i.test(color) ? parseInt(color.slice(7), 16) : 255;
    return `${color.slice(0, 7)}${Math.round(alpha * 0.4).toString(16).padStart(2, "0")}`;
  }, []);
  const [chartAppearance, setChartAppearance, appearanceRestored] = useSavedState<ChartAppearance>("chart.appearance.v1", DEFAULT_CHART_APPEARANCE);
  const [chartStylePreferences, setChartStylePreferences] = useState<ChartStylePreferences>({ style: 1, favorites: [], settings: {} });
  const [chartStyleRestored, setChartStyleRestored] = useState(false);
  const chartStyle = chartStylePreferences.style;
  const chartStyleRef = useRef(chartStyle);
  chartStyleRef.current = chartStyle;
  const activeStyleSettings = chartStylePreferences.settings[chartStyle] ?? defaultStyleSettings(chartStyle);
  useEffect(() => {
    setChartStylePreferences(readChartStylePreferences());
    setChartStyleRestored(true);
  }, []);
  useEffect(() => {
    if (chartStyleRestored) saveChartStylePreferences(chartStylePreferences);
  }, [chartStylePreferences, chartStyleRestored]);
  const [mainScaleInverted, setMainScaleInverted] = useState(false);
  const [mainPaneIndex, setMainPaneIndex] = useState(0);
  const [legendBounds, setLegendBounds] = useState({ left: 0, right: 0, top: 0, comparisonTop: 0, volumeTop: 0, sourceTops: {} as Record<string, number> });
  const [paneRevision, setPaneRevision] = useState(0);
  const [panePresentation, setPanePresentation] = useState<PanePresentation>({ hidden: [], collapsed: [] });
  const updatePanePresentation = useCallback((next: PanePresentation) => {
    setPanePresentation((current) => current.hidden.join() === next.hidden.join() && current.collapsed.join() === next.collapsed.join() ? current : next);
  }, []);
  const mainPanePlotVisible = !panePresentation.hidden.includes(mainPaneIndex) && !panePresentation.collapsed.includes(mainPaneIndex);
  const comparisonActive = compareSymbols.length > 0;
  const mainScaleSide = scaleSideOverride ?? "right";
  const indicatorScaleSides = {
    macd: indicatorScaleSideOverrides.macd ?? mainScaleSide,
    rsi: indicatorScaleSideOverrides.rsi ?? mainScaleSide,
  };
  const effectiveScaleMode = scaleMode;
  const setMainScaleMode = useCallback((mode: ScaleMode) => {
    if (mode === "percent" || mode === "indexed") {
      setAutoScale(true);
      setScaleLocked(false);
    } else if (mode === "log") setScaleLocked(false);
    setScaleMode(mode);
  }, []);
  const toggleMainAutoScale = useCallback(() => {
    setScaleLocked(false);
    setAutoScale((enabled) => !enabled);
  }, []);
  const axisLabelsRef = useRef(axisLabels);
  const axisLinesRef = useRef(axisLines);
  const seriesOnlyRef = useRef(seriesOnlyScale);
  mainScaleSideRef.current = mainScaleSide;
  mainPaneIndexRef.current = mainPaneIndex;
  indicatorScaleSidesRef.current = indicatorScaleSides;
  scaleLockedRef.current = scaleLocked;
  zoomModeRef.current = zoomMode;
  axisLabelsRef.current = axisLabels;
  axisLinesRef.current = axisLines;
  seriesOnlyRef.current = seriesOnlyScale;
  const symbolInfo = resolvedSymbol?.symbol === symbol ? resolvedSymbol.info : undefined;

  useEffect(() => {
    const saved = readAxisSettings();
    setScaleMode(saved.mode);
    setScaleSideOverride(saved.side);
    setAutoScale(replayRef.current ? true : saved.autoScale);
    setMainScaleInverted(saved.inverted);
    setScaleLocked(replayRef.current ? false : saved.locked);
    setSeriesOnlyScale(saved.seriesOnly);
    setCountdownVisible(saved.countdown);
    setAxisLabels(saved.labels);
    setAxisLines(saved.lines);
    setChartAppearance((current) => ({ ...current, topMargin: saved.margins.top, bottomMargin: saved.margins.bottom }));
    setVolumeScaleSideOverride(saved.volumeSide);
    setIndicatorScaleSideOverrides(saved.indicatorSides);
    sourceScaleOverridesRef.current = new Map(Object.entries(saved.sourceSides));
    setAxisSettingsRestored(true);
  }, []);

  useEffect(() => {
    if (!axisSettingsRestored || replayMode) return;
    writeAxisSettings({
      mode: scaleMode, side: mainScaleSide, autoScale, inverted: mainScaleInverted,
      locked: scaleLocked, seriesOnly: seriesOnlyScale, countdown: countdownVisible,
      labels: axisLabels, lines: axisLines,
      margins: { top: chartAppearance.topMargin, bottom: chartAppearance.bottomMargin },
      volumeSide: volumeScaleSideOverride, indicatorSides: indicatorScaleSideOverrides,
      sourceSides: Object.fromEntries(sourceScaleOverridesRef.current),
    });
  }, [axisSettingsRestored, scaleMode, mainScaleSide, autoScale, mainScaleInverted, scaleLocked, seriesOnlyScale, countdownVisible, axisLabels, axisLines, chartAppearance.topMargin, chartAppearance.bottomMargin, volumeScaleSideOverride, indicatorScaleSideOverrides, paneRevision, replayMode]);

  useEffect(() => {
    const disableTabNavigation = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (event.key !== "Tab") return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };

    document.addEventListener("keydown", disableTabNavigation, true);
    return () => document.removeEventListener("keydown", disableTabNavigation, true);
  }, []);

  useEffect(() => {
    if (replayMode) { setSymbolRestored(true); setCompareSymbols([]); return; }
    try {
      const restoredSymbol = normalizeStoredSymbol(localStorage.getItem(SYMBOL_STORAGE_KEY));
      setSymbol(restoredSymbol);
      setCompareSymbols(normalizeStoredCompareSymbols(
        localStorage.getItem(COMPARE_SYMBOLS_STORAGE_KEY),
        restoredSymbol,
      ));
      setRecentCompareSymbols(normalizeStoredRecentCompareSymbols(
        localStorage.getItem(RECENT_COMPARE_SYMBOLS_STORAGE_KEY),
        restoredSymbol,
      ));
    } catch {
      setSymbol(DEFAULT_SYMBOL);
      setCompareSymbols([]);
      setRecentCompareSymbols([]);
    } finally {
      setSymbolRestored(true);
    }
  }, [replayMode]);

  useEffect(() => {
    if (!symbolRestored || replayMode) return;
    try {
      localStorage.setItem(SYMBOL_STORAGE_KEY, symbol);
      localStorage.setItem(COMPARE_SYMBOLS_STORAGE_KEY, JSON.stringify(compareSymbols));
      localStorage.setItem(RECENT_COMPARE_SYMBOLS_STORAGE_KEY, JSON.stringify(recentCompareSymbols));
    } catch {
      return;
    }
  }, [compareSymbols, recentCompareSymbols, symbol, symbolRestored, replayMode]);

  useEffect(() => {
    if (replayMode) { setResolutionRestored(true); return; }
    try {
      setResolution(normalizeStoredResolution(localStorage.getItem(RESOLUTION_STORAGE_KEY)));
    } catch {
      setResolution(DEFAULT_RESOLUTION);
    } finally {
      setResolutionRestored(true);
    }
  }, [replayMode]);

  useEffect(() => {
    if (!resolutionRestored || replayMode) return;
    try {
      localStorage.setItem(RESOLUTION_STORAGE_KEY, resolution);
    } catch {
      return;
    }
  }, [resolution, resolutionRestored, replayMode]);

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
      day: drawingHistoryDayRef.current,
      undo: drawingHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES),
      redo: drawingRedoHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES),
    };
    localStorage.setItem(
      drawingHistoryStorageKey(drawingKeyRef.current),
      JSON.stringify(history),
    );
  }, []);

  const resetChartView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setScaleLocked(false);
    autoScaleRef.current = true;
    setAutoScale(true);
    chart.timeScale().resetTimeScale();
    chart.panes().forEach((pane) => {
      for (const side of ["left", "right"] as const) chart.priceScale(side, pane.paneIndex()).setAutoScale(true);
    });
    followLatestRef.current = true;
  }, []);

  const ensureDrawingHistoryDay = useCallback(() => {
    const day = drawingHistoryDay(exchangeTimezoneRef.current);
    if (drawingHistoryDayRef.current === day) return;
    drawingHistoryDayRef.current = day;
    drawingHistoryRef.current = [drawingHistoryRef.current.at(-1) ?? "[]"];
    drawingRedoHistoryRef.current = [];
    zoomHistoryRef.current = [];
    setZoomHistoryCount(0);
    persistDrawingHistory();
    syncDrawingHistoryAvailability();
  }, [persistDrawingHistory, syncDrawingHistoryAvailability]);

  useEffect(() => {
    exchangeTimezoneRef.current = symbolInfo?.timezone ?? "Asia/Bangkok";
    ensureDrawingHistoryDay();
    const timer = window.setInterval(ensureDrawingHistoryDay, 30_000);
    document.addEventListener("visibilitychange", ensureDrawingHistoryDay);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ensureDrawingHistoryDay);
    };
  }, [symbolInfo?.timezone, ensureDrawingHistoryDay]);

  const recordDrawingState = useCallback((drawingState: string) => {
    ensureDrawingHistoryDay();
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
  }, [ensureDrawingHistoryDay, persistDrawingHistory, syncDrawingHistoryAvailability]);

  const restoreDrawingState = useCallback((drawingState: string) => {
    const lineTools = lineToolsRef.current;
    if (!lineTools) return;
    lineTools.removeAllLineTools();
    if (drawingsHiddenRef.current) hiddenDrawingsRef.current = drawingState;
    else if (drawingState !== "[]") lineTools.importLineTools(drawingState);
    setSelectedDrawing(null);
    if (drawingKeyRef.current) {
      localStorage.setItem(drawingKeyRef.current, drawingState);
    }
    persistDrawingHistory();
  }, [persistDrawingHistory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (replayRef.current) return;
      if (e.defaultPrevented || document.querySelector('[role="dialog"]')) return;
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
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        setIntervalQuery(e.key);
        return;
      }

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
    settingsLoaded: indicatorSettingsRestored,
    setActiveStudies,
    maLength,
    setMaLength,
    maType,
    setMaType,
    smoothingLength,
    setSmoothingLength,
  } = useIndicatorSettings();
  const studyLabelsVisible = useCallback((studySeries: ReferenceSeries) => {
    const pane = studySeries.getPane();
    const volumePane = volumeSeriesRef.current?.getPane();
    return axisLabelsRef.current.studyValues && studySeries.options().priceFormat.type !== "volume"
      && (pane !== volumePane || pane === seriesRef.current?.getPane());
  }, []);
  const referenceStudies = useReferenceStudies(chartRef, barsByTimeRef, symbol, resolution, symbolInfo, chartStyle, studyLabelsVisible,
    () => setVisibleBar((bar) => bar ? { ...bar } : currentBarRef.current));
  const secondaryLeftVisible = (activeStudies.includes("macd") && indicatorScaleSides.macd === "left")
    || (activeStudies.includes("rsi") && indicatorScaleSides.rsi === "left");
  const secondaryRightVisible = (activeStudies.includes("macd") && indicatorScaleSides.macd === "right")
    || (activeStudies.includes("rsi") && indicatorScaleSides.rsi === "right");
  resolutionRef.current = resolution;
  symbolTimezoneRef.current = effectiveChartTimezone;
  maSettingsRef.current = { length: maLength, type: maType, smoothingLength };
  const volumeIntervalIndex = resolution === "D" ? 2 : resolution === "W" ? 3 : resolution === "M" ? 4 : Number(resolution) >= 60 ? 1 : 0;
  const volumeAllowed = volumeVisualSettings.visibleIntervals[volumeIntervalIndex] ?? true;
  useEffect(() => {
    if (!selectedLegend) return;
    const clearSelection = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".market-data__title, .indicator-data__title, .series-menu, .volume-dialog")) return;
      setSelectedLegend(null);
    };
    document.addEventListener("pointerdown", clearSelection, true);
    return () => document.removeEventListener("pointerdown", clearSelection, true);
  }, [selectedLegend]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const refresh = () => {
      const range = chart.timeScale().getVisibleRange();
      const bars = [...barsByTimeRef.current.values()].filter((bar) => !range || (Number(bar.time) >= Number(range.from) && Number(bar.time) <= Number(range.to)));
      const step = Math.max(1, Math.ceil(bars.length / 10));
      const selectedBars = bars.filter((_bar, index) => index % step === 0 || index === bars.length - 1);
      const mainMarkers: SeriesMarker<Time>[] = !marksHidden && selectedLegend === "instrument" ? selectedBars.map((bar) => ({ time: bar.time, price: chartStyleRendererRef.current?.displayPrice(bar) ?? bar.close, position: "atPriceMiddle", shape: "circle", color: "#2962ff", size: 1 })) : [];
      const volumeMarkers: SeriesMarker<Time>[] = !marksHidden && selectedLegend === "volume" ? selectedBars.map((bar) => ({ time: bar.time, price: bar.volume, position: "atPriceTop", shape: "circle", color: "#2962ff", size: 1 })) : [];
      mainSelectionMarkersRef.current?.setMarkers(mainMarkers);
      volumeSelectionMarkersRef.current?.setMarkers(volumeMarkers);
    };
    refreshSelectionMarkersRef.current = refresh;
    chart.timeScale().subscribeVisibleTimeRangeChange(refresh);
    refresh();
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(refresh);
      refreshSelectionMarkersRef.current = () => undefined;
    };
  }, [selectedLegend, symbol, resolution, marksHidden]);
  autoScaleRef.current = autoScale;
  activeDrawingToolRef.current = activeDrawingTool;
  stayInDrawingModeRef.current = stayInDrawingMode;
  eraserModeRef.current = eraserMode;
  textDialogOpenRef.current = textDialogOpen;

  useEffect(() => {
    if (!symbolRestored || !resolutionRestored || replayMode) return;
    const controller = new AbortController();
    const { from, to } = rangeForResolution(resolution, rangeDays);
    const request = {
      symbol,
      resolution,
      rangeDays,
      promise: fetchHistory(symbol, resolution, from, to, controller.signal),
    };
    preloadedHistoryRef.current = request;
    void request.promise.catch(() => undefined);
    setHistoryLoading(true);
    return () => {
      controller.abort();
      if (preloadedHistoryRef.current === request) preloadedHistoryRef.current = null;
    };
  }, [rangeDays, resolution, resolutionRestored, symbol, symbolRestored, replayMode, fetchHistory]);
  useEffect(() => {
    if (!symbolRestored) return;
    if (replayMode) {
      setResolvedSymbol({ symbol, info: { name: symbol, description: symbol, type: "futures", exchange: symbol === "DEMO" ? "DEMO" : "HNX", timezone: "Asia/Bangkok", session: "0000-0000", minMove: symbol === "DEMO" ? .01 : .1, priceScale: symbol === "DEMO" ? 100 : 10, supportedResolutions: ["1"] } });
      if (symbol === "DEMO") return;
      const metadataController = new AbortController();
      void fetchSymbolInfo(symbol, metadataController.signal).then(info => {
        if (!metadataController.signal.aborted) setResolvedSymbol({ symbol, info: { ...info, supportedResolutions: ["1"] } });
      }).catch(() => undefined);
      return () => metadataController.abort();
    }
    const controller = new AbortController();
    setDataError(undefined);
    setVisibleBar(undefined);
    currentBarRef.current = undefined;
    lockedCrosshairRef.current = null;
    setCrosshairLocked(false);
    setChartMenu(null);
    barsByTimeRef.current.clear();
    previousCloseByTimeRef.current.clear();
    chartStyleRendererRef.current?.setBars([]);
    volumeSeriesRef.current?.setData([]);
    volumeMaSeriesRef.current?.setData([]);
    volumeSmaSeriesRef.current?.setData([]);
    timelineSeriesRef.current?.setData([]);
    fetchSymbolInfo(symbol, controller.signal)
      .then((info) => setResolvedSymbol({ symbol, info }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDataError(error instanceof Error ? error.message : "symbol metadata failed");
        setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [symbol, symbolRestored, replayMode]);

  const openTextDialog = useCallback((drawing: LineToolExport<LineToolType>) => {
    const snapshot = structuredClone(drawing);
    if (snapshot.toolType === "PriceNote") {
      const options = snapshot.options as PriceNoteOptions;
      snapshot.options = { ...options, priceNote: priceNoteSettings(options) };
    }
    setEditingTextDrawing(snapshot);
    setTextDialogOpen(true);
  }, []);

  const streamingStudies = useRef(new StreamingIndicators());
  const streamingVolume = useRef(new StreamingIndicators());
  const volumeHistory = useRef<Map<number, Bar> | null>(null);

  const updateStudySeries = (rawBars: Bar[]) => {
    volumeHistory.current = null;
    referenceStudies.update(rawBars);
    const bars = chartStudyBars(rawBars, chartStyleRef.current);
    streamingStudies.current.reset(bars);
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
        panes: { enableResize: true, separatorColor: "rgb(125, 125, 125)", separatorHoverColor: "rgba(178, 181, 189, 0.2)" },
      },
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, symbolTimezoneRef.current),
        percentageFormatter: (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`,
        tickmarksPercentageFormatter: (values: number[]) => values.map((value) => `${value.toFixed(2)}%`),
      },
      grid: {
        vertLines: { color: "#303948" },
        horzLines: { color: "#303948" },
      },
      // Cho phép đường ngắm và nhãn giá di chuyển tự do
      crosshair: { mode: CrosshairMode.Normal },
      leftPriceScale: {
        visible: false,
        borderVisible: true,
        borderColor: "#787b86",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: "#787b86",
        scaleMargins: { top: 0.02, bottom: 0 },
      },
      defaultVisiblePriceScaleId: "right",
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: true,
        borderColor: "#787b86",
        barSpacing: 14,
        minBarSpacing: 0.5,
        rightOffset: 6,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        tickMarkFormatter: (time: Time) => formatTick(
          time,
          resolutionRef.current,
          symbolTimezoneRef.current,
        ),
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
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "right",
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
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
      visible: false,
    });
    const volumeMaSeries = chart.addSeries(LineSeries, {
      color: "#2962ff",
      lineWidth: 1,
      lineType: LineType.Simple,
      priceScaleId: "right",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });
    const series = chart.addSeries(CandlestickSeries, {
      title: symbol,
      priceScaleId: "right",
      upColor: "#53B987",
      downColor: "#EB4D5C",
      borderVisible: false,
      wickUpColor: "#53B987",
      wickDownColor: "#EB4D5C",
      priceLineVisible: true,
      priceLineColor: "#EB4D5C",
      lastValueVisible: true,
      baseLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    installVisibleCandleOpenAsPercentReference(series);
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
    chartStyleRendererRef.current = new ChartStyleRenderer(chart, series, containerRef.current, (baseLevel) => {
      setChartStylePreferences((current) => ({ ...current, settings: { ...current.settings, 10: { ...(current.settings[10] ?? defaultStyleSettings(10)), baseLevel } } }));
    });
    highLowLinesRef.current = null;
    volumeSeriesRef.current = volumeSeries;
    volumeMaSeriesRef.current = volumeMaSeries;
    volumeSmaSeriesRef.current = volumeSmaSeries;
    mainSelectionMarkersRef.current = createSeriesMarkers(series, [], { zOrder: "top" });
    volumeSelectionMarkersRef.current = createSeriesMarkers(volumeSeries, [], { zOrder: "top" });
    timelineSeriesRef.current = timelineSeries;

    let crosshairLabelVisible = true;
    chart.subscribeCrosshairMove((param) => {
      if (!renderingRef.current) return;
      hoveredMainSeriesRef.current = param.hoveredSeries === series && param.point
        ? { x: param.point.x, y: param.point.y, paneIndex: param.paneIndex ?? mainPaneIndexRef.current } : null;
      const locked = lockedCrosshairRef.current;
      if (locked) {
        const paneSeries = chart.panes()[param.paneIndex ?? mainPaneIndexRef.current]?.getSeries()
          .find((item) => item.options().visible && item.data().length > 0);
        if (param.point && paneSeries) {
          const price = paneSeries.coordinateToPrice(param.point.y);
          if (price !== null) {
            locked.price = price;
            locked.series = paneSeries as typeof locked.series;
          }
        }
        chart.setCrosshairPosition(locked.price, locked.time, locked.series);
      }
      const volumePane = volumeSeriesRef.current?.getPane().paneIndex();
      const showLabel = param.paneIndex !== volumePane || volumePane === mainPaneIndexRef.current;
      if (showLabel !== crosshairLabelVisible) {
        crosshairLabelVisible = showLabel;
        chart.applyOptions({ crosshair: { horzLine: { labelVisible: showLabel } } });
      }
      const time = locked?.time ?? param.time;
      crosshairDrawingPointRef.current = param.point && time && param.paneIndex === mainPaneIndexRef.current
        ? { timestamp: Number(time), price: series.coordinateToPrice(param.point.y) ?? NaN } : null;
      if (panGestureRef.current?.active) return;
      setVisibleBar(time ? barsByTimeRef.current.get(Number(time)) : currentBarRef.current);
    });

    const lineTools = createDrawingTools(chart, series, () => resolutionRef.current);
    lineTools.setMagnetThreshold(0);
    const persistDrawingState = () => {
      recordDrawingState(lineTools.exportLineTools());
    };
    lineTools.subscribeLineToolsAfterEdit((event) => {
      let selectedLineTool = event.selectedLineTool;
      const appearance = priceRangeAppearance(selectedLineTool);
      if (appearance) {
        selectedLineTool = { ...selectedLineTool, options: appearance as typeof selectedLineTool.options };
        lineTools.createOrUpdateLineTool(selectedLineTool.toolType, selectedLineTool.points, selectedLineTool.options, selectedLineTool.id);
      }
      setSelectedDrawing(selectedLineTool);
      if (!textDialogOpenRef.current) saveDrawingDefaults(selectedLineTool);
      persistDrawingState();
      if (event.stage !== "lineToolFinished") return;

      if (selectedLineTool.toolType === "Text" || selectedLineTool.toolType === "Callout") {
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
      if (event.selectedLineTool.toolType === "Text" || event.selectedLineTool.toolType === "Callout" || event.selectedLineTool.toolType === "PriceNote") openTextDialog(event.selectedLineTool);
    });
    const refreshDrawingOverlays = (range?: { from: number; to: number } | null) => {
      if (!renderingRef.current) return;
      setDrawingViewportVersion((current) => current + 1);
      if (range && Number(range.from) <= 20) loadOlderHistoryRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshDrawingOverlays);
    lineToolsRef.current = lineTools;

    const onZoomPointerDown = (event: PointerEvent) => {
      if (!zoomModeRef.current || event.button !== 0) return;
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const plotLeft = safePriceScaleWidth(chart, "left", mainPaneIndexRef.current);
      const plotRight = rect.width - safePriceScaleWidth(chart, "right", mainPaneIndexRef.current);
      const paneRect = series.getPane().getHTMLElement()?.getBoundingClientRect();
      if (!paneRect) return;
      const plotTop = paneRect.top - rect.top;
      const plotHeight = chart.paneSize(mainPaneIndexRef.current).height;
      const x = event.clientX - rect.left;
      const y = event.clientY - paneRect.top;
      if (x < plotLeft || x > plotRight || y < 0 || y > plotHeight) return;
      event.preventDefault();
      event.stopPropagation();
      zoomStartRef.current = { pointerId: event.pointerId, x, y, plotLeft, plotRight, plotTop, plotHeight };
      element.setPointerCapture(event.pointerId);
      setZoomSelection({ left: x, top: y + plotTop + element.offsetTop, width: 0, height: 0 });
    };

    const onZoomPointerMove = (event: PointerEvent) => {
      const start = zoomStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const element = containerRef.current;
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const x = Math.max(start.plotLeft, Math.min(start.plotRight, event.clientX - rect.left));
      const y = Math.max(0, Math.min(start.plotHeight, event.clientY - rect.top - start.plotTop));
      setZoomSelection({
        left: Math.min(start.x, x),
        top: Math.min(start.y, y) + start.plotTop + element.offsetTop,
        width: Math.abs(x - start.x),
        height: Math.abs(y - start.y),
      });
    };

    const onZoomPointerEnd = (event: PointerEvent) => {
      const start = zoomStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const element = containerRef.current;
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      zoomStartRef.current = null;
      setZoomSelection(null);
      zoomModeRef.current = false;
      setZoomMode(false);
      chart.applyOptions({ handleScroll: { pressedMouseMove: true } });
      if (event.type === "pointercancel") return;

      const rect = element.getBoundingClientRect();
      const endX = Math.max(start.plotLeft, Math.min(start.plotRight, event.clientX - rect.left));
      const endY = Math.max(0, Math.min(start.plotHeight, event.clientY - rect.top - start.plotTop));
      if (Math.abs(endX - start.x) < 4) return;
      const timeScale = chart.timeScale();
      const first = timeScale.coordinateToLogical(start.x - start.plotLeft);
      const last = timeScale.coordinateToLogical(endX - start.plotLeft);
      const selectedTime = first === null || last === null
        ? null
        : selectedZoomRange(Math.round(first), Math.round(last), 1);
      const previousTime = timeScale.getVisibleLogicalRange();
      if (!selectedTime || !previousTime) return;
      const targetTime = { from: selectedTime.from - 0.5, to: selectedTime.to + 0.5 };

      const priceScale = chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current);
      const previousPrice = priceScale.getVisibleRange();
      const firstPrice = series.coordinateToPrice(start.y);
      const lastPrice = series.coordinateToPrice(endY);
      const selectedPrice = Math.abs(endY - start.y) >= 4 && firstPrice !== null && lastPrice !== null
        ? selectedZoomRange(firstPrice, lastPrice, 1e-8)
        : null;
      zoomHistoryRef.current.push({
        leftOffset: previousTime.from - targetTime.from,
        rightOffset: previousTime.to - targetTime.to,
        barSpacing: chart.paneSize(mainPaneIndexRef.current).width / (previousTime.to - previousTime.from),
        priceRange: previousPrice,
        priceScaleMode: priceScale.options().mode,
        autoScale: priceScale.options().autoScale,
        followLatest: followLatestRef.current,
      });
      setZoomHistoryCount(zoomHistoryRef.current.length);
      followLatestRef.current = false;
      viewportInteractionRef.current += 1;
      timeScale.setVisibleLogicalRange(targetTime);
      if (selectedPrice && priceScale.options().mode !== PriceScaleMode.Percentage && priceScale.options().mode !== PriceScaleMode.IndexedTo100) {
        autoScaleRef.current = false;
        setAutoScale(false);
        setVisiblePriceRange(priceScale, selectedPrice);
      }
    };

    const cancelZoomOnEscape = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (event.key !== "Escape" || !zoomModeRef.current) return;
      zoomStartRef.current = null;
      setZoomSelection(null);
      zoomModeRef.current = false;
      setZoomMode(false);
      chart.applyOptions({ handleScroll: { pressedMouseMove: true } });
    };

    let userGesture: { pointerId: number; x: number; y: number } | null = null;
    const onUserPointerDown = (event: PointerEvent) => {
      if (event.button === 0 && !zoomModeRef.current) {
        userGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }
    };
    const onUserPointerMove = (event: PointerEvent) => {
      if (!userGesture || userGesture.pointerId !== event.pointerId || !event.buttons) return;
      if (Math.hypot(event.clientX - userGesture.x, event.clientY - userGesture.y) < 4) return;
      userGesture = null;
      followLatestRef.current = false;
      viewportInteractionRef.current += 1;
    };
    const onUserPointerEnd = () => { userGesture = null; };

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
      const paneRect = series.getPane().getHTMLElement()?.getBoundingClientRect();
      if (!paneRect) return;
      const y = event.clientY - paneRect.top;
      const leftScaleWidth = safePriceScaleWidth(chart, "left", mainPaneIndexRef.current);
      const rightScaleWidth = safePriceScaleWidth(chart, "right", mainPaneIndexRef.current);
      if (x <= leftScaleWidth || x >= rect.width - rightScaleWidth || y < 0 || y >= chart.paneSize(mainPaneIndexRef.current).height) return;

      const priceScale = chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current);
      if (priceScale.options().mode === PriceScaleMode.Percentage || priceScale.options().mode === PriceScaleMode.IndexedTo100) return;
      const priceRange = priceScale.getVisibleRange();
      if (!priceRange) return;
      const captureTarget = event.target instanceof Element ? event.target : element;
      setVisiblePriceRange(chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current), priceRange);

      panGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        captureTarget,
      };
      try { captureTarget.setPointerCapture(event.pointerId); } catch { panGestureRef.current = null; }
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
    const cancelPan = () => {
      const gesture = panGestureRef.current;
      if (gesture) finishPan({ pointerId: gesture.pointerId } as PointerEvent);
      userGesture = null;
    };

    let plotWheelState: WheelState = { totalX: 0, totalY: 0, lastTime: 0 };
    const axisWheelStates = new Map<string, WheelState>();
    const onChartWheel = (event: WheelEvent) => {
      const element = containerRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const hoveredPane = chart.panes().find((pane) => {
        const paneRect = pane.getHTMLElement()?.getBoundingClientRect();
        return paneRect && event.clientY >= paneRect.top && event.clientY < paneRect.bottom;
      });
      if (!hoveredPane) return;
      const paneIndex = hoveredPane.paneIndex();
      const paneRect = hoveredPane.getHTMLElement()?.getBoundingClientRect();
      if (!paneRect) return;
      const leftScale = chart.priceScale("left", paneIndex);
      const rightScale = chart.priceScale("right", paneIndex);
      const leftWidth = safePriceScaleWidth(chart, "left", paneIndex);
      const rightWidth = safePriceScaleWidth(chart, "right", paneIndex);
      const scale = leftWidth > 0 && pointerX <= leftWidth
        ? leftScale
        : rightWidth > 0 && pointerX >= rect.width - rightWidth
          ? rightScale
          : null;
      if (scale) {
        const side = scale === leftScale ? "left" : "right";
        const wheelKey = `${paneIndex}:${side}`;
        const wheel = bundleWheelDelta(event.deltaX, event.deltaY, event.deltaMode, event.timeStamp, axisWheelStates.get(wheelKey) ?? { totalX: 0, totalY: 0, lastTime: 0 });
        axisWheelStates.set(wheelKey, wheel.state);
        if (wheel.y === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const isMainScale = paneIndex === mainPaneIndexRef.current && side === mainScaleSideRef.current;
        if (isMainScale && scaleLockedRef.current) return;
        if ([PriceScaleMode.Percentage, PriceScaleMode.IndexedTo100].includes(scale.options().mode)) return;
        const range = scale.getVisibleRange();
        if (!range) return;
        const logicalRange = scale.options().mode === PriceScaleMode.Logarithmic ? logarithmicPriceRange(scale, range) : range;
        const nextRange = bundlePriceWheelRange(logicalRange, paneRect.height, event.clientY - paneRect.top, wheel.y);
        if (!nextRange) return;
        followLatestRef.current = false;
        viewportInteractionRef.current += 1;
        scale.setVisibleRange(nextRange);
        refreshDrawingOverlays();
        setHoverAxis((current) => current ? { ...current } : current);
        setFooterAxis((current) => current ? { ...current } : current);
        if (isMainScale) {
          autoScaleRef.current = false;
          setAutoScale(false);
        }
        return;
      }

      const wheel = bundleWheelDelta(event.deltaX, event.deltaY, event.deltaMode, event.timeStamp, plotWheelState);
      plotWheelState = wheel.state;
      if (wheel.x === 0 && wheel.y === 0) return;
      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range) return;
      const plotWidth = rect.width - leftWidth - rightWidth;
      if (plotWidth <= 0) return;
      const pointerFraction = (pointerX - leftWidth) / plotWidth;
      const zoomedRange = wheel.y !== 0
        ? bundleTimeWheelRange(range, wheel.y, event.ctrlKey || event.metaKey ? pointerFraction : undefined)
        : range;
      if (!zoomedRange) return;
      const spacing = plotWidth / (zoomedRange.to - zoomedRange.from);
      const scrollBars = 80 * wheel.x / spacing;
      const nextRange = {
        from: zoomedRange.from + scrollBars,
        to: zoomedRange.to + scrollBars,
      };
      followLatestRef.current = false;
      viewportInteractionRef.current += 1;
      timeScale.setVisibleLogicalRange(nextRange);
      event.preventDefault();
      event.stopPropagation();
    };

    const element = containerRef.current;
    if (!element) return;
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", finishPan);
    element.addEventListener("pointercancel", finishPan);
    element.addEventListener("lostpointercapture", finishPan);
    window.addEventListener("blur", cancelPan);
    element.addEventListener("pointerdown", onZoomPointerDown, true);
    element.addEventListener("pointermove", onZoomPointerMove, true);
    element.addEventListener("pointerup", onZoomPointerEnd, true);
    element.addEventListener("pointercancel", onZoomPointerEnd, true);
    element.addEventListener("pointerdown", onUserPointerDown, true);
    element.addEventListener("pointermove", onUserPointerMove, true);
    element.addEventListener("pointerup", onUserPointerEnd, true);
    element.addEventListener("pointercancel", onUserPointerEnd, true);
    element.addEventListener("wheel", onChartWheel, { capture: true, passive: false });
    window.addEventListener("keydown", cancelZoomOnEscape);

    // autoSize quản lý kích thước; chỉ cập nhật lớp vẽ sau khi bố trí thay đổi.
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => refreshDrawingOverlays());
    });
    resizeObserver.observe(containerRef.current);
    resizeFrame = requestAnimationFrame(() => refreshDrawingOverlays());

    const compareViews = compareViewsRef.current;
    const compareIntervalAllowed = compareIntervalAllowedRef.current;
    const compareRawBars = compareRawBarsRef.current;
    const compareInfo = compareInfoRef.current;

    return () => {
      cancelPan();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", finishPan);
      element.removeEventListener("pointercancel", finishPan);
      element.removeEventListener("lostpointercapture", finishPan);
      window.removeEventListener("blur", cancelPan);
      element.removeEventListener("pointerdown", onZoomPointerDown, true);
      element.removeEventListener("pointermove", onZoomPointerMove, true);
      element.removeEventListener("pointerup", onZoomPointerEnd, true);
      element.removeEventListener("pointercancel", onZoomPointerEnd, true);
      element.removeEventListener("pointerdown", onUserPointerDown, true);
      element.removeEventListener("pointermove", onUserPointerMove, true);
      element.removeEventListener("pointerup", onUserPointerEnd, true);
      element.removeEventListener("pointercancel", onUserPointerEnd, true);
      element.removeEventListener("wheel", onChartWheel, true);
      window.removeEventListener("keydown", cancelZoomOnEscape);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(refreshDrawingOverlays);
      lineTools.destroy();
      lineToolsRef.current = null;
      chartStyleRendererRef.current?.destroy();
      chartStyleRendererRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      mainSelectionMarkersRef.current = null;
      volumeSelectionMarkersRef.current = null;
      volumeSeriesRef.current = null;
      volumeMaSeriesRef.current = null;
      volumeSmaSeriesRef.current = null;
      compareSeriesRef.current.clear();
      compareViews.clear();
      compareIntervalAllowed.clear();
      compareRawBars.clear();
      compareInfo.clear();
      compareBarsRef.current.clear();
      priceIndicatorSeriesRef.current.clear();
      macdSeriesRef.current = null;
      rsiSeriesRef.current = null;
      timelineSeriesRef.current = null;
      highLowLinesRef.current = null;
    };
  }, [recordDrawingState]);

  const replayStudyRefresh = useRef(updateStudySeries);
  replayStudyRefresh.current = updateStudySeries;
  const replayInitialized = useRef(false);
  const renderedReplaySession = useRef<number | undefined>(undefined);
  // Chụp canvas của chart, không lấy DOM toolbar hoặc browser chrome.
  const captureChartCanvas = useCallback(() => chartRef.current?.takeScreenshot(), []);
  useEffect(() => {
    if (!replayMode || !onReplayReady) return;
    drawingKeyRef.current = `backtest.drawings.${replaySession}`;
    onReplayReady({
      screenshot: () => {
        const canvas = captureChartCanvas();
        if (!canvas) throw new Error("Chart chưa sẵn sàng.");
        return canvas.toDataURL("image/png");
      },
      drawings: () => {
        const lines = JSON.parse(lineToolsRef.current?.exportLineTools() || "[]") as LineToolExport<LineToolType>[];
        return lines.filter(line => ["TrendLine", "HorizontalLine", "Ray", "ExtendedLine"].includes(line.toolType)).map(line => ({ id: line.id, tool: line.toolType as ReplayDrawing["tool"], points: line.points, label: String((line.options as { text?: { value?: string } }).text?.value || "") }));
      },
      apply: drawings => {
        for (const drawing of drawings) {
          // Giữ kiểu options của plugin để tránh lỗi index signature trong DeepPartial.
          const options = { ...drawingPreset(drawing.tool), text: { value: drawing.label } } as LineToolPartialOptionsMap[typeof drawing.tool];
          lineToolsRef.current?.createOrUpdateLineTool(drawing.tool, drawing.points, options, drawing.id.startsWith("ai-") ? drawing.id : `ai-${drawing.id}`);
        }
        recordDrawingState(lineToolsRef.current?.exportLineTools() || "[]");
      },
      reset: () => lineToolsRef.current?.removeAllLineTools(),
    });
    return () => onReplayReady(null);
  }, [replayMode, onReplayReady, replaySession, recordDrawingState, captureChartCanvas]);

  useEffect(() => {
    if (!replayMode || !chartRef.current) return;
    // Mỗi bước replay bật lại auto scale để nến mới nằm trong vùng giá đang hiển thị.
    autoScaleRef.current = true;
    scaleLockedRef.current = false;
    setAutoScale(true);
    setScaleLocked(false);
    chartRef.current.panes().forEach(pane => {
      for (const side of ["left", "right"] as const) chartRef.current?.priceScale(side, pane.paneIndex()).setAutoScale(true);
    });
    if (renderedReplaySession.current !== replaySession) {
      renderedReplaySession.current = replaySession;
      replayInitialized.current = false;
      resetChartView();
      loadedAxisContextRef.current = null;
      zoomHistoryRef.current = [];
      setZoomHistoryCount(0);
      hiddenDrawingsRef.current = null;
      lineToolsRef.current?.removeAllLineTools();
      drawingHistoryRef.current = ["[]"];
      drawingRedoHistoryRef.current = [];
      syncDrawingHistoryAvailability();
      setSelectedDrawing(null);
      setEditingTextDrawing(null);
      setTextDialogOpen(false);
      lockedCrosshairRef.current = null;
      setCrosshairLocked(false);
    }
    const bars = (replayFrame?.bars || []).map(bar => ({ ...bar, time: bar.time as Bar["time"] }));
    barsByTimeRef.current = new Map(bars.map(bar => [Number(bar.time), bar]));
    previousCloseByTimeRef.current = new Map(bars.slice(1).map((bar, index) => [Number(bar.time), bars[index].close]));
    currentBarRef.current = bars.at(-1);
    chartStyleRendererRef.current?.setBars(bars);
    seriesRef.current?.applyOptions({ title: symbol });
    volumeSeriesRef.current?.setData(bars.map((bar, index) => ({ time: bar.time, value: bar.volume, color: volumeColorForBar(bar, bars[index - 1]?.close) })));
    const settings = maSettingsRef.current;
    volumeMaSeriesRef.current?.setData(volumeMa(bars, settings.length, "SMA", 1));
    volumeSmaSeriesRef.current?.setData(volumeMa(bars, settings.length, settings.type, settings.smoothingLength));
    replayStudyRefresh.current(bars);
    setVisibleBar(bars.at(-1));
    setHistoryLoading(false);
    refreshHighLowRef.current();
    refreshSelectionMarkersRef.current();
    syncCompareSeries();
    if (bars.length && !replayInitialized.current) { seriesRef.current?.priceScale().setAutoScale(true); chartRef.current.timeScale().fitContent(); replayInitialized.current = true; }
    else if (followLatestRef.current) chartRef.current.timeScale().scrollToRealTime();
    navigateHistoryRef.current = async target => {
      const index = bars.findIndex(bar => Number(bar.time) >= target);
      if (index < 0) throw new Error("Chưa có dữ liệu tại mốc replay này.");
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, index - 50), to: Math.min(bars.length + 5, index + 50) });
    };
  }, [replayMode, replayFrame, replaySession, symbol, setVisibleBar, syncCompareSeries, volumeColorForBar, resetChartView, syncDrawingHistoryAvailability]);

  // Tải lịch sử và kết nối lại dữ liệu trực tiếp khi mã hoặc khung thời gian đổi
  useEffect(() => {
    if (replayMode) return;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !symbolInfo || !resolutionRestored || !axisSettingsRestored) return;
    const activeSession = symbolInfo.session;
    const activeTimezone = symbolInfo.timezone;
    const activePriceFormat = symbolPriceFormat(symbolInfo);

    let cancelled = false;
    const loadGeneration = ++historyLoadGenerationRef.current;
    const interactionAtLoad = viewportInteractionRef.current;
    followLatestRef.current = true;
    loadedAxisContextRef.current = null;
    let loadingOlderHistory = false;
    setOlderHistoryLoading(false);
    let olderHistoryExhausted = false;
    const historyAbortController = new AbortController();
    loadOlderHistoryRef.current = () => undefined;
    navigateHistoryRef.current = async () => { throw new Error("Dữ liệu đang tải, vui lòng thử lại"); };
    setDataError(undefined);
    setHistoryLoading(true);
    series.applyOptions({ title: symbol, priceFormat: activePriceFormat });
    const realtimeTickBuffer = createRealtimeTickBuffer<PriceTick>(
      (tick) => Number(bucketStart(tick.time, resolution)),
    );
    currentBarRef.current = undefined;
    zoomHistoryRef.current = [];
    setZoomHistoryCount(0);
    zoomStartRef.current = null;
    setZoomSelection(null);
    zoomModeRef.current = false;
    setZoomMode(false);
    drawingKeyRef.current = drawingStorageKey(symbol, resolution);
    hiddenDrawingsRef.current = null;
    setSelectedDrawing(null);
    setTextDialogOpen(false);
    setEditingTextDrawing(null);
    lineToolsRef.current?.removeAllLineTools();

    (async () => {
      const { from, to } = rangeForResolution(resolution, rangeDays);
      let bars: Bar[] = [];
      try {
        const preload = preloadedHistoryRef.current;
        bars = await (preload
          && preload.symbol === symbol
          && preload.resolution === resolution
          && preload.rangeDays === rangeDays
          ? preload.promise
          : fetchHistory(symbol, resolution, from, to, historyAbortController.signal));
      } catch (error: unknown) {
        if (cancelled || historyAbortController.signal.aborted) return;
        realtimeTickBuffer.dispose();
        chartStyleRendererRef.current?.setBars([]);
        volumeSeriesRef.current?.setData([]);
        volumeMaSeriesRef.current?.setData([]);
        volumeSmaSeriesRef.current?.setData([]);
        timelineSeriesRef.current?.setData([]);
        barsByTimeRef.current.clear();
        previousCloseByTimeRef.current.clear();
        currentBarRef.current = undefined;
        setVisibleBar(undefined);
        setDataError(error instanceof Error ? error.message : "history fetch failed");
        setHistoryLoading(false);
        return;
      }
      if (cancelled) return;
      const chartBars = bars.filter((bar) => isTradingSessionTime(
        bar.time,
        resolution,
        activeSession,
        activeTimezone,
      ));
      chartStyleRendererRef.current?.setBars(chartBars);
      refreshSelectionMarkersRef.current();
      if (chartBars.length) {
        lastRenderedRealtimeBucketRef.current = Number(chartBars[chartBars.length - 1].time);
      }
      const volumeBars = chartBars;
      volumeSeriesRef.current?.setData(volumeBars.map((bar, index) => ({
        time: bar.time,
        value: bar.volume,
        color: volumeColorForBar(bar, volumeBars[index - 1]?.close),
      })));
      const settings = maSettingsRef.current;
      volumeMaSeriesRef.current?.setData(volumeMa(volumeBars, settings.length, "SMA", 1));
      volumeSmaSeriesRef.current?.setData(volumeMa(
        volumeBars,
        settings.length,
        settings.type,
        settings.smoothingLength,
      ));
      updateStudySeries(chartBars);
      if (chartBars.length) timelineSeriesRef.current?.setData(futureTimelinePoints(Number(chartBars[chartBars.length - 1].time), resolution));
      barsByTimeRef.current = new Map(chartBars.map((bar) => [Number(bar.time), bar]));
      refreshHighLowRef.current();
      syncCompareSeries();
      previousCloseByTimeRef.current = new Map(chartBars.slice(1).map((bar, index) => [Number(bar.time), chartBars[index].close]));
      let earliestHistoryTime = chartBars[0] ? Number(chartBars[0].time) : undefined;
      const historyWindowSeconds = Math.max(86400, to - from);

      navigateHistoryRef.current = async (targetFrom, targetTo) => {
        dateNavigationControllerRef.current?.abort();
        const controller = new AbortController();
        dateNavigationControllerRef.current = controller;
        const abort = () => controller.abort();
        historyAbortController.signal.addEventListener("abort", abort, { once: true });
        const timeScale = chart.timeScale();
        const previousRange = timeScale.getVisibleLogicalRange();
        const span = previousRange ? previousRange.to - previousRange.from : DEFAULT_VISIBLE_BARS;
        followLatestRef.current = false;
        viewportInteractionRef.current += 1;
        try {
          let loaded = [...barsByTimeRef.current.values()].sort((a, b) => Number(a.time) - Number(b.time));
          const first = Number(loaded[0]?.time);
          const last = Number(loaded.at(-1)?.time);
          if (!loaded.length || targetFrom < first || (targetTo ?? targetFrom) > last) {
            const interval = resolution === "M" ? 2592000 : resolution === "W" ? 604800 : resolution === "D" ? 86400 : Number(resolution) * 60;
            const padding = Math.max(7 * 86400, interval * span * 2);
            const incoming = await fetchHistory(symbol, resolution,
              Math.floor(Math.min(targetFrom - padding, Number.isFinite(first) ? first : targetFrom)),
              Math.floor(Math.min(Date.now() / 1000, Math.max((targetTo ?? targetFrom) + padding, Number.isFinite(last) ? last : targetFrom))), controller.signal);
            if (cancelled || controller.signal.aborted) return;
            const filtered = incoming.filter((bar) => isTradingSessionTime(bar.time, resolution, activeSession, activeTimezone));
            if (!filtered.length && (!loaded.length || targetFrom < first)) throw new Error("Không có dữ liệu tại ngày đã chọn");
            await Promise.all([...compareSeriesRef.current.keys()].map(async (compareSymbol) => {
              const info = await fetchSymbolInfo(compareSymbol, controller.signal);
              const history = await fetchHistory(compareSymbol, resolution,
                Math.floor(targetFrom - padding), Math.floor(Math.min(Date.now() / 1000, Math.max((targetTo ?? targetFrom) + padding, Number.isFinite(last) ? last : targetFrom))), controller.signal);
              if (cancelled || controller.signal.aborted || !compareSeriesRef.current.has(compareSymbol)) return;
              const merged = new Map(history.filter((bar) => isTradingSessionTime(bar.time, resolution, info.session, info.timezone)).map(bar => [Number(bar.time), bar]));
              compareRawBarsRef.current.get(compareSymbol)?.forEach(bar => merged.set(Number(bar.time), bar));
              const raw = [...merged.values()].sort((a, b) => Number(a.time) - Number(b.time));
              compareRawBarsRef.current.set(compareSymbol, raw);
              compareBarsRef.current.set(compareSymbol, comparisonPoints(raw, normalizeComparisonSettings(comparisonSettingsRef.current[compareSymbol])));
            }));
            if (cancelled || controller.signal.aborted) return;
            loaded = mergeBars([...barsByTimeRef.current.values()], filtered);
            barsByTimeRef.current = new Map(loaded.map((bar) => [Number(bar.time), bar]));
            previousCloseByTimeRef.current = new Map(loaded.slice(1).map((bar, index) => [Number(bar.time), loaded[index].close]));
            earliestHistoryTime = Number(loaded[0]?.time);
            olderHistoryExhausted = false;
            chartStyleRendererRef.current?.setBars(loaded);
            volumeSeriesRef.current?.setData(loaded.map((bar, index) => ({ time: bar.time, value: bar.volume, color: volumeColorForBar(bar, loaded[index - 1]?.close) })));
            const settings = maSettingsRef.current;
            volumeMaSeriesRef.current?.setData(volumeMa(loaded, settings.length, "SMA", 1));
            volumeSmaSeriesRef.current?.setData(volumeMa(loaded, settings.length, settings.type, settings.smoothingLength));
            updateStudySeries(loaded);
            syncCompareSeries();
          }
          if (cancelled || controller.signal.aborted) return;
          if (!loaded.length) throw new Error("Không có dữ liệu tại ngày đã chọn");
          const nearest = (timestamp: number) => {
            const index = loaded.findIndex((bar) => Number(bar.time) >= timestamp);
            return index < 0 ? loaded.length - 1 : index;
          };
          const firstIndex = nearest(targetFrom);
          const firstLogical = timeScale.timeToIndex(loaded[firstIndex].time, true);
          if (firstLogical === null) throw new Error("Không thể xác định ngày trên biểu đồ");
          if (targetTo === undefined) timeScale.setVisibleLogicalRange({ from: firstLogical - span / 2, to: firstLogical + span / 2 });
          else {
            const lastLogical = timeScale.timeToIndex(loaded[nearest(targetTo)].time, true) ?? firstLogical;
            timeScale.setVisibleLogicalRange({ from: firstLogical - 0.5, to: Math.max(firstLogical + 1, lastLogical + 0.5) });
          }
          refreshSelectionMarkersRef.current();
          refreshHighLowRef.current();
          setDataError(undefined);
        } finally {
          historyAbortController.signal.removeEventListener("abort", abort);
          if (dateNavigationControllerRef.current === controller) dateNavigationControllerRef.current = null;
        }
      };

      loadOlderHistoryRef.current = () => {
        if (!renderingRef.current) return;
        if (cancelled || dateNavigationControllerRef.current || loadingOlderHistory || olderHistoryExhausted || earliestHistoryTime === undefined) return;
        loadingOlderHistory = true;
        setOlderHistoryLoading(true);
        const pageTo = earliestHistoryTime - 1;
        const pageFrom = pageTo - historyWindowSeconds;
        void fetchHistory(symbol, resolution, pageFrom, pageTo, historyAbortController.signal)
          .then((olderBars) => {
            if (cancelled || dateNavigationControllerRef.current) return;
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

            const visibleRange = chart.timeScale().getVisibleRange();
            const priceScale = chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current);
            const priceRange = !autoScaleRef.current ? priceScale.getVisibleRange() : null;

            barsByTimeRef.current = new Map(mergedBars.map((bar) => [Number(bar.time), bar]));
            syncCompareSeries();
            previousCloseByTimeRef.current = new Map(
              mergedBars.slice(1).map((bar, index) => [Number(bar.time), mergedBars[index].close]),
            );
            earliestHistoryTime = Number(mergedBars[0].time);
            chartStyleRendererRef.current?.setBars(mergedBars);
            refreshSelectionMarkersRef.current();
            refreshHighLowRef.current();
            volumeSeriesRef.current?.setData(mergedBars.map((bar, index) => ({
              time: bar.time,
              value: bar.volume,
              color: volumeColorForBar(bar, mergedBars[index - 1]?.close),
            })));
            const currentSettings = maSettingsRef.current;
            volumeMaSeriesRef.current?.setData(volumeMa(mergedBars, currentSettings.length, "SMA", 1));
            volumeSmaSeriesRef.current?.setData(volumeMa(
              mergedBars,
              currentSettings.length,
              currentSettings.type,
              currentSettings.smoothingLength,
            ));
            updateStudySeries(mergedBars);
            if (visibleRange) chart.timeScale().setVisibleRange(visibleRange);
            if (priceRange) setVisiblePriceRange(priceScale, priceRange);
            setDataError(undefined);
          })
          .catch((error: unknown) => {
            if (cancelled || historyAbortController.signal.aborted) return;
            setDataError(error instanceof Error ? error.message : "older history fetch failed");
          })
          .finally(() => {
            loadingOlderHistory = false;
            if (!cancelled) setOlderHistoryLoading(false);
          });
      };
      const visibleBars = DEFAULT_VISIBLE_BARS;

      const focusLatestBars = () => {
        if (cancelled || chartBars.length === 0) return;

        if (rangeDays !== undefined) {
          chart.timeScale().setVisibleLogicalRange({ from: 0, to: chartBars.length + 5 });
        } else if (chartBars.length > visibleBars) {
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, chartBars.length - visibleBars),
            to: chartBars.length + 6,
          });
        } else {
          chart.timeScale().setVisibleLogicalRange({ from: 0, to: chartBars.length + 5 });
        }

        const scale = chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current);
        const mode = scale.options().mode;
        const savedMode: ScaleMode = mode === PriceScaleMode.Logarithmic ? "log" : mode === PriceScaleMode.Percentage ? "percent" : mode === PriceScaleMode.IndexedTo100 ? "indexed" : "normal";
        const automatic = mode === PriceScaleMode.Percentage || mode === PriceScaleMode.IndexedTo100 || (autoScaleRef.current && !scaleLockedRef.current);
        scale.setAutoScale(true);
        refreshPriceScaleData(chart, scale);
        const savedRange = !automatic ? readManualAxisRange(symbol, resolution, savedMode) : null;
        if (savedRange) setVisiblePriceRange(scale, savedRange);
        scale.setAutoScale(automatic);
        loadedAxisContextRef.current = `${symbol}:${resolution}`;
        if (scaleLockedRef.current) setPaneRevision((revision) => revision + 1);
      };

      const initializeViewport = () => {
        if (cancelled || historyLoadGenerationRef.current !== loadGeneration
          || viewportInteractionRef.current !== interactionAtLoad) return;
        if (chart.paneSize().width === 0) {
          requestAnimationFrame(initializeViewport);
          return;
        }
        focusLatestBars();
      };
      requestAnimationFrame(initializeViewport);
      const savedDrawings = localStorage.getItem(drawingKeyRef.current);
      const normalizedDrawings = savedDrawings
        ? normalizeDrawingState(savedDrawings)
        : "[]";
      if (savedDrawings) {
        if (drawingsHiddenRef.current) hiddenDrawingsRef.current = normalizedDrawings;
        else lineToolsRef.current?.importLineTools(normalizedDrawings);
        if (normalizedDrawings !== savedDrawings) {
          localStorage.setItem(drawingKeyRef.current, normalizedDrawings);
        }
      }
      const day = drawingHistoryDay(activeTimezone);
      const restoredHistory = restoreDrawingHistory(
        localStorage.getItem(drawingHistoryStorageKey(drawingKeyRef.current)), normalizedDrawings, day, normalizeDrawingState,
      );
      drawingHistoryDayRef.current = day;
      drawingHistoryRef.current = restoredHistory.undo;
      drawingRedoHistoryRef.current = restoredHistory.redo;
      persistDrawingHistory();
      syncDrawingHistoryAvailability();
      if (chartBars.length) {
        currentBarRef.current = chartBars[chartBars.length - 1];
        lastRealtimeBucketRef.current = Number(currentBarRef.current.time);
        setVisibleBar(currentBarRef.current);
      }
      setHistoryLoading(false);
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
      volumeMaSeriesRef.current?.setData(volumeMa(allBars, settings.length, "SMA", 1));
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
      const activeChart = chartRef.current;
      const timeScale = activeChart?.timeScale();
      const panning = Boolean(panGestureRef.current?.active);
      const visibleLogical = isNewRenderedBucket ? timeScale?.getVisibleLogicalRange() : null;
      const visibleTime = isNewRenderedBucket ? timeScale?.getVisibleRange() : null;
      const manualPriceScale = isNewRenderedBucket && activeChart && !autoScaleRef.current
        ? activeChart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current)
        : null;
      const visiblePrice = manualPriceScale?.getVisibleRange();
      if (isNewRenderedBucket) timelineSeriesRef.current?.setData(futureTimelinePoints(bucketNumber, resolution));

      chartStyleRendererRef.current?.update(bar);
      if (isNewRenderedBucket) updateCompareSeries(bar.time);
      refreshSelectionMarkersRef.current();
      refreshHighLowRef.current(bar);
      volumeSeriesRef.current?.update({
        time: bar.time,
        value: bar.volume,
        color: volumeColorForBar(bar, previousCloseByTimeRef.current.get(bucketNumber)),
      });

      if (volumeHistory.current !== barsByTimeRef.current) {
        streamingVolume.current.reset([...barsByTimeRef.current.values()]);
        volumeHistory.current = barsByTimeRef.current;
      } else streamingVolume.current.update(bar);
      const currentSettings = maSettingsRef.current;
      const latestVolumeSma = streamingVolume.current.volume(
        currentSettings.length,
        currentSettings.type,
        currentSettings.smoothingLength,
      );
      if (latestVolumeSma) volumeSmaSeriesRef.current?.update(latestVolumeSma);
      const latestVolumeMa = streamingVolume.current.volume(currentSettings.length, "SMA", 1);
      if (latestVolumeMa) volumeMaSeriesRef.current?.update(latestVolumeMa);
      if (referenceStudies.instances.current.size > 0 || priceIndicatorSeriesRef.current.size > 0 || macdSeriesRef.current || rsiSeriesRef.current) {
        const stream = streamingStudies.current;
        stream.update(chartStyleRendererRef.current?.displayBar(bar) ?? bar);
        if (referenceStudies.instances.current.size) referenceStudies.update([...barsByTimeRef.current.values()], true);
        PRICE_INDICATORS.forEach(({ id, length, type }) => {
          const series = priceIndicatorSeriesRef.current.get(id);
          if (!series) return;
          const point = stream.price(length, type);
          if (point) series.update(point);
        });
        if (["BOLL_UPPER", "BOLL_MIDDLE", "BOLL_LOWER"].some((id) => priceIndicatorSeriesRef.current.has(id))) {
          const bands = stream.bollinger();
          for (const band of ["upper", "middle", "lower"]) {
            const point = bands.get(band);
            if (point) priceIndicatorSeriesRef.current.get(`BOLL_${band.toUpperCase()}`)?.update(point);
          }
        }
        if (macdSeriesRef.current) {
          const values = stream.macd();
          const macd = values.get("macd"), signal = values.get("signal"), histogram = values.get("histogram");
          if (macd) macdSeriesRef.current.macd.update(macd);
          if (signal) macdSeriesRef.current.signal.update(signal);
          if (histogram) macdSeriesRef.current.histogram.update({ ...histogram, color: histogram.value >= 0 ? "rgba(83,185,135,.65)" : "rgba(235,77,92,.65)" });
        }
        if (rsiSeriesRef.current) {
          const point = stream.rsi();
          if (point) {
            rsiSeriesRef.current.rsi.update(point);
            rsiSeriesRef.current.upper.update({ time: point.time, value: 70 });
            rsiSeriesRef.current.lower.update({ time: point.time, value: 30 });
          }
        }
      }

      if (isNewRenderedBucket && timeScale) {
        const previousBarIndex = barsByTimeRef.current.size - 2;
        const previousBarVisible = visibleLogical != null
          && previousBarIndex >= visibleLogical.from
          && previousBarIndex <= visibleLogical.to;
        if (panning && visibleTime) {
          timeScale.setVisibleRange(visibleTime);
        } else if (visibleLogical && (followLatestRef.current || previousBarVisible)) {
          timeScale.setVisibleLogicalRange({ from: visibleLogical.from + 1, to: visibleLogical.to + 1 });
        } else if (visibleTime) {
          timeScale.setVisibleRange(visibleTime);
        }
      }
      if (visiblePrice && manualPriceScale) setVisiblePriceRange(manualPriceScale, visiblePrice);

      lastRenderedRealtimeBucketRef.current = bucketNumber;
      setVisibleBar(bar);
    };

    const realtimeScheduler = createChartRenderScheduler(
      () => renderingRef.current,
      (rebuild) => {
        const bar = currentBarRef.current;
        if (!bar || cancelled) return;
        if (rebuild) {
          const allBars = [...barsByTimeRef.current.values()].sort((a, b) => Number(a.time) - Number(b.time));
          const timeScale = chart.timeScale();
          const range = timeScale.getVisibleLogicalRange();
          const priceScale = !autoScaleRef.current
            ? chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current) : null;
          const priceRange = priceScale?.getVisibleRange();
          const oldIndex = allBars.findIndex((item) => Number(item.time) === lastRenderedRealtimeBucketRef.current);
          chartStyleRendererRef.current?.setBars(allBars);
          syncCompareSeries();
          volumeSeriesRef.current?.setData(allBars.map((item, index) => ({
            time: item.time, value: item.volume, color: volumeColorForBar(item, allBars[index - 1]?.close),
          })));
          refreshVolumeMa();
          updateStudySeries(allBars);
          timelineSeriesRef.current?.setData(futureTimelinePoints(Number(bar.time), resolution));
          if (range) {
            const shift = followLatestRef.current && oldIndex >= 0 ? allBars.length - 1 - oldIndex : 0;
            timeScale.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
          }
          if (priceRange && priceScale) setVisiblePriceRange(priceScale, priceRange);
          lastRenderedRealtimeBucketRef.current = Number(bar.time);
        }
        renderRealtimeBar(bar);
      },
    );
    flushRealtimeRef.current = realtimeScheduler.flush;
    suspendRealtimeRef.current = realtimeScheduler.suspend;

    function processRealtimeTick(tick: PriceTick) {
      const bucket = bucketStart(tick.time, resolution);
      const bucketNumber = Number(bucket);
      if (!isTradingSessionTime(bucket, resolution, activeSession, activeTimezone)) {
        return;
      }
      const isNewBucket = lastRealtimeBucketRef.current !== bucketNumber;
      const previousBar = currentBarRef.current;
      if (previousBar && bucketNumber < Number(previousBar.time)) return;
      // Vẽ nến cũ trước khi sang nến mới để giữ đủ dữ liệu OHLCV.
      if (isNewBucket) realtimeScheduler.flush();
      if (isNewBucket && previousBar) {
        previousCloseByTimeRef.current.set(bucketNumber, previousBar.close);
      }
      currentBarRef.current = mergeTick(currentBarRef.current, tick.price, tick.volume, bucket);
      lastRealtimeBucketRef.current = bucketNumber;
      barsByTimeRef.current.set(bucketNumber, currentBarRef.current);
      // Gộp các lần vẽ trong cùng một khung hình, vẫn xử lý đầy đủ từng giao dịch.
      realtimeScheduler.schedule();
    }

    realtimeTickHandlerRef.current = (tick) => {
      realtimeTickBuffer.push(tick, processRealtimeTick);
    };

    return () => {
      cancelled = true;
      historyAbortController.abort();
      realtimeScheduler.dispose();
      realtimeTickBuffer.dispose();
      loadOlderHistoryRef.current = () => undefined;
      realtimeTickHandlerRef.current = () => undefined;
      flushRealtimeRef.current = () => undefined;
      suspendRealtimeRef.current = () => undefined;
    };
  }, [axisSettingsRestored, persistDrawingHistory, rangeDays, resolution, resolutionRestored, symbol, symbolInfo, syncCompareSeries, updateCompareSeries, syncDrawingHistoryAvailability, replayMode, fetchHistory]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const activeSymbols = new Set(compareSymbols);
    setComparisonStatus(Object.fromEntries(compareSymbols.map(item => [item, "loading" as const])));
    setComparisonQuotes([]);
    compareSeriesRef.current.forEach((series, compareSymbol) => {
      if (activeSymbols.has(compareSymbol)) return;
      chart.removeSeries(series);
      compareSeriesRef.current.delete(compareSymbol);
      compareViewsRef.current.delete(compareSymbol);
      compareRawBarsRef.current.delete(compareSymbol);
      compareInfoRef.current.delete(compareSymbol);
      compareHiddenRef.current.delete(compareSymbol);
      compareIntervalAllowedRef.current.delete(compareSymbol);
      compareBarsRef.current.delete(compareSymbol);
    });

    let cancelled = false;
    const controller = new AbortController();
    const feeds: ReturnType<typeof connectPriceFeed>[] = [];
    const { from, to } = replayMode ? { from: replayRef.current?.frame?.bars[0]?.time ?? 0, to: replayCutoff ?? 0 } : rangeForResolution(resolution, rangeDays);

    compareSymbols.forEach((compareSymbol, index) => {
      let series = compareSeriesRef.current.get(compareSymbol);
      const settings = normalizeComparisonSettings(comparisonSettingsRef.current[compareSymbol], COMPARE_COLORS[index % COMPARE_COLORS.length]);
      if (!series) {
        const view = new ReferenceStudyView(COMPARISON_DEFINITION, comparisonReferenceSettings(settings));
        compareViewsRef.current.set(compareSymbol, view);
        compareIntervalAllowedRef.current.set(compareSymbol, comparisonAllowed(settings, resolution));
        series = chart.addCustomSeries(view, {
          title: axisLabelsRef.current.symbol ? compareSymbol : "",
          color: settings.color,
          priceScaleId: sourceScaleOverridesRef.current.get(`compare:${compareSymbol}`) ?? mainScaleSideRef.current,
          lastValueVisible: axisLabelsRef.current.seriesValue,
          priceLineVisible: settings.priceLine,
          priceLineColor: settings.color,
          baseLineVisible: false,
          visible: !compareHiddenRef.current.has(compareSymbol) && comparisonAllowed(settings, resolution),
          autoscaleInfoProvider: seriesOnlyRef.current ? () => null : undefined,
        }, mainPaneIndexRef.current);
        compareSeriesRef.current.set(compareSymbol, series);
      }
      compareBarsRef.current.delete(compareSymbol);
      compareRawBarsRef.current.delete(compareSymbol);
      series.setData([]);

      void Promise.all([
        fetchSymbolInfo(compareSymbol, controller.signal),
        fetchHistory(compareSymbol, resolution, from, to, controller.signal),
      ]).then(([info, bars]) => {
        if (cancelled) return;
        const compareBars = bars.filter((bar) => isTradingSessionTime(
          bar.time,
          resolution,
          info.session,
          info.timezone,
        ));
        compareInfoRef.current.set(compareSymbol, info);
        compareRawBarsRef.current.set(compareSymbol, compareBars);
        const currentSettings = normalizeComparisonSettings(comparisonSettingsRef.current[compareSymbol], settings.color);
        compareBarsRef.current.set(compareSymbol, comparisonPoints(compareBars, currentSettings));
        series!.applyOptions({ priceFormat: comparisonPriceFormat(currentSettings, info) });
        syncCompareSeries();
        setComparisonStatus(current => ({ ...current, [compareSymbol]: "ready" }));
        const latestCompareBar = compareBars.at(-1);
        const comparePreviousClose = compareBars.at(-2)?.close ?? latestCompareBar?.close ?? 0;
        if (latestCompareBar) {
          const change = latestCompareBar.close - comparePreviousClose;
          const quote: ComparisonQuote = {
            symbol: compareSymbol,
            description: info.description,
            exchange: info.exchange,
            price: latestCompareBar.close,
            change,
            changePercent: comparePreviousClose ? change / comparePreviousClose * 100 : 0,
            color: COMPARE_COLORS[index % COMPARE_COLORS.length],
          };
          setComparisonQuotes((current) => [
            ...current.filter((item) => item.symbol !== compareSymbol),
            quote,
          ]);
        }

        if (replayMode) return;
        const feed = connectPriceFeed(
          compareSymbol,
          (tick) => {
            const bucket = bucketStart(tick.time, resolution);
            if (!isTradingSessionTime(bucket, resolution, info.session, info.timezone)) return;
            const points = compareBarsRef.current.get(compareSymbol);
            const raw = compareRawBarsRef.current.get(compareSymbol);
            if (!points || !raw) return;
            const lastPoint = points.at(-1);
            if (lastPoint && Number(bucket) < Number(lastPoint.time)) return;
            const lastBar = raw.at(-1);
            if (lastBar && Number(lastBar.time) === Number(bucket)) {
              lastBar.high = Math.max(lastBar.high, tick.price);
              lastBar.low = Math.min(lastBar.low, tick.price);
              lastBar.close = tick.price;
            } else raw.push({ time: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.volume ?? 0 });
            const settings = normalizeComparisonSettings(comparisonSettingsRef.current[compareSymbol], COMPARE_COLORS[index % COMPARE_COLORS.length]);
            const point = comparisonPoints([raw.at(-1)!], settings)[0];
            if (lastPoint && Number(bucket) === Number(lastPoint.time)) lastPoint.value = point.value;
            else points.push(point);
            const change = tick.price - comparePreviousClose;
            const pendingQuote: ComparisonQuote = {
              symbol: compareSymbol, description: info.description, exchange: info.exchange,
              price: tick.price, change, changePercent: comparePreviousClose ? change / comparePreviousClose * 100 : 0,
              color: COMPARE_COLORS[index % COMPARE_COLORS.length],
            };
            if (!renderingRef.current) {
              pendingComparisonQuotesRef.current.set(compareSymbol, pendingQuote);
              return;
            }
            const mainTime = currentBarRef.current?.time;
            if (mainTime !== undefined) updateCompareSeries(mainTime);
            setComparisonQuotes((current) => [...current.filter(quote => quote.symbol !== compareSymbol), pendingQuote]);
          },
          () => undefined,
        );
        feeds.push(feed);
      }).catch(() => {
        if (!cancelled) {
          setComparisonStatus(current => ({ ...current, [compareSymbol]: "error" }));
          compareBarsRef.current.delete(compareSymbol);
          compareRawBarsRef.current.delete(compareSymbol);
          series?.setData([]);
        }
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
      feeds.forEach((feed) => feed.close());
    };
  }, [compareSymbols, rangeDays, resolution, syncCompareSeries, updateCompareSeries, replayMode, replayCutoff, fetchHistory]);

  useEffect(() => {
    compareSeriesRef.current.forEach((series, compareSymbol) => {
      const view = compareViewsRef.current.get(compareSymbol);
      const settings = normalizeComparisonSettings(comparisonSettings[compareSymbol], view?.settings.styles.compare.color);
      if (view) view.settings = comparisonReferenceSettings(settings);
      if (compareIntervalAllowedRef.current.get(compareSymbol) && series.options().visible === false) compareHiddenRef.current.add(compareSymbol);
      const allowed = comparisonAllowed(settings, resolution);
      compareIntervalAllowedRef.current.set(compareSymbol, allowed);
      series.applyOptions({
        color: settings.color, priceLineColor: settings.color, priceLineVisible: settings.priceLine,
        priceFormat: comparisonPriceFormat(settings, compareInfoRef.current.get(compareSymbol)),
        visible: !compareHiddenRef.current.has(compareSymbol) && allowed,
      });
      const bars = compareRawBarsRef.current.get(compareSymbol);
      if (bars) compareBarsRef.current.set(compareSymbol, comparisonPoints(bars, settings));
    });
    syncCompareSeries();
  }, [comparisonSettings, comparisonStatus, resolution, syncCompareSeries]);

  useEffect(() => {
    if (replayMode) return;
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
  }, [symbol, replayMode]);

  useEffect(() => {
    if (!active || !documentVisible) {
      suspendRealtimeRef.current();
      return;
    }
    flushRealtimeRef.current();
    if (pendingComparisonQuotesRef.current.size) {
      syncCompareSeries();
      const pending = new Map(pendingComparisonQuotesRef.current);
      pendingComparisonQuotesRef.current.clear();
      setComparisonQuotes((current) => current.map((quote) => pending.get(quote.symbol) ?? quote));
    }
  }, [active, documentVisible, syncCompareSeries]);

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
    volumeMaSeriesRef.current?.setData(volumeMa(bars, maLength, "SMA", 1));
  }, [maLength, maType, resolution, smoothingLength, symbolInfo?.session, symbolInfo?.timezone]);

  useEffect(() => {
    const bars = [...barsByTimeRef.current.values()].sort((a, b) => Number(a.time) - Number(b.time));
    volumeSeriesRef.current?.setData(bars.map((bar, index) => ({
      time: bar.time,
      value: bar.volume,
      color: volumeColorForBar(bar, bars[index - 1]?.close),
    })));
    volumeMaSeriesRef.current?.applyOptions({
      color: volumeVisualSettings.maColor,
      lineType: volumeVisualSettings.maPlotStyle === "step" ? LineType.WithSteps : volumeVisualSettings.maPlotStyle === "curved" ? LineType.Curved : LineType.Simple,
      lineStyle: volumeVisualSettings.maPlotStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
      priceLineVisible: volumeVisualSettings.maPriceLineVisible,
      lastValueVisible: false,
    });
    volumeSmaSeriesRef.current?.applyOptions({
      color: volumeVisualSettings.smoothedColor,
      lineType: volumeVisualSettings.smoothedPlotStyle === "step" ? LineType.WithSteps : volumeVisualSettings.smoothedPlotStyle === "curved" ? LineType.Curved : LineType.Simple,
      lineStyle: volumeVisualSettings.smoothedPlotStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
      priceLineVisible: volumeVisualSettings.smoothedPriceLineVisible,
      lastValueVisible: false,
    });
    volumeSeriesRef.current?.applyOptions({ lastValueVisible: false });
  }, [volumeVisualSettings, volumeColorForBar]);

  type MovableSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Histogram"> | ISeriesApi<"Line"> | ReferenceSeries;

  const transferSeriesGroup = useCallback((group: MovableSeries[], targetPane: ReturnType<MovableSeries["getPane"]>) => {
    const markerRefs = [mainSelectionMarkersRef, volumeSelectionMarkersRef];
    const markedSeries = [seriesRef.current, volumeSeriesRef.current];
    const suspended = markerRefs.flatMap((ref, index) => {
      const series = markedSeries[index];
      if (!series || !group.includes(series) || !ref.current) return [];
      const markers = [...ref.current.markers()];
      ref.current.detach();
      ref.current = null;
      return [{ ref, series, markers }];
    });
    const sourcePane = group[0].getPane();
    const preserveSource = sourcePane.preserveEmptyPane();
    // Giữ chỉ số cửa sổ ổn định và tạm ngắt dấu chọn khi chuỗi chưa có cửa sổ.
    sourcePane.setPreserveEmptyPane(true);
    try {
      group.forEach((item) => item.moveToPane(targetPane.paneIndex()));
    } finally {
      sourcePane.setPreserveEmptyPane(preserveSource);
      if (!preserveSource && sourcePane.getSeries().length === 0) {
        chartRef.current?.removePane(sourcePane.paneIndex());
      }
      suspended.forEach(({ ref, series, markers }) => {
        ref.current = createSeriesMarkers(series, markers, { zOrder: "top" });
      });
    }
  }, []);

  const syncPaneLayout = useCallback(() => {
    const chart = chartRef.current;
    const main = seriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!chart || !main || !volume) return;
    const mainPane = main.getPane();

    const nextMainIndex = mainPane.paneIndex();
    mainPaneIndexRef.current = nextMainIndex;
    setMainPaneIndex(nextMainIndex);
    setVolumePaneIndex(volume.getPane().paneIndex());
    setPaneRevision((value) => value + 1);
  }, []);

  const volumeAddedRef = useRef(false);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const active = new Set(activeStudies);
    if (active.has("volume") && !volumeAddedRef.current) {
      const group = [volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current]
        .filter((item): item is NonNullable<typeof item> => item !== null);
      if (group.length) transferSeriesGroup(group, chart.addPane());
    }
    volumeAddedRef.current = active.has("volume");
    PRICE_INDICATORS.forEach((indicator) => {
      let series = priceIndicatorSeriesRef.current.get(indicator.id);
      if (active.has(indicator.study) && !series) {
        series = chart.addSeries(LineSeries, {
          title: axisLabelsRef.current.studyNames ? indicator.id : "",
          color: indicator.color,
          lineWidth: 2,
          priceScaleId: sourceScaleOverridesRef.current.get(`study:${indicator.id}`) ?? mainScaleSideRef.current,
          lastValueVisible: axisLabelsRef.current.studyValues,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: seriesOnlyRef.current ? () => null : undefined,
        }, chart.panes().length);
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
    let bollingerPane = priceIndicatorSeriesRef.current.get("BOLL_MIDDLE")?.getPane();
    bollingerLines.forEach((indicator) => {
      let series = priceIndicatorSeriesRef.current.get(indicator.id);
      if (active.has("boll") && !series) {
        series = chart.addSeries(LineSeries, {
          title: axisLabelsRef.current.studyNames ? indicator.id : "",
          color: indicator.color,
          lineWidth: 2,
          priceScaleId: sourceScaleOverridesRef.current.get(`study:${indicator.id}`) ?? mainScaleSideRef.current,
          lastValueVisible: axisLabelsRef.current.studyValues,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: seriesOnlyRef.current ? () => null : undefined,
        }, bollingerPane?.paneIndex() ?? chart.panes().length);
        bollingerPane = series.getPane();
        priceIndicatorSeriesRef.current.set(indicator.id, series);
      } else if (!active.has("boll") && series) {
        chart.removeSeries(series);
        priceIndicatorSeriesRef.current.delete(indicator.id);
      }
    });

    if (!active.has("macd") && macdSeriesRef.current) {
      chart.removeSeries(macdSeriesRef.current.histogram);
      chart.removeSeries(macdSeriesRef.current.macd);
      chart.removeSeries(macdSeriesRef.current.signal);
      macdSeriesRef.current = null;
    }
    if (!active.has("rsi") && rsiSeriesRef.current) {
      chart.removeSeries(rsiSeriesRef.current.rsi);
      chart.removeSeries(rsiSeriesRef.current.upper);
      chart.removeSeries(rsiSeriesRef.current.lower);
      rsiSeriesRef.current = null;
    }
    let paneIndex = chart.panes().length;
    if (active.has("macd") && !macdSeriesRef.current) {
      const histogram = chart.addSeries(HistogramSeries, { title: axisLabelsRef.current.studyNames ? "Histogram" : "", priceScaleId: indicatorScaleSidesRef.current.macd, priceLineVisible: false, lastValueVisible: axisLabelsRef.current.studyValues }, paneIndex);
      const macd = chart.addSeries(LineSeries, { title: axisLabelsRef.current.studyNames ? "MACD" : "", priceScaleId: indicatorScaleSidesRef.current.macd, color: "#2962ff", lineWidth: 2, priceLineVisible: false, lastValueVisible: axisLabelsRef.current.studyValues }, paneIndex);
      const signal = chart.addSeries(LineSeries, { title: axisLabelsRef.current.studyNames ? "Signal" : "", priceScaleId: indicatorScaleSidesRef.current.macd, color: "#ff6d00", lineWidth: 2, priceLineVisible: false, lastValueVisible: axisLabelsRef.current.studyValues }, paneIndex);
      macdSeriesRef.current = { histogram, macd, signal };
      chart.panes()[paneIndex]?.setHeight(140);
      chart.priceScale(indicatorScaleSidesRef.current.macd, paneIndex).applyOptions({ mode: PriceScaleMode.Normal });
      paneIndex++;
    }
    if (active.has("rsi") && !rsiSeriesRef.current) {
      const rsi = chart.addSeries(LineSeries, { title: axisLabelsRef.current.studyNames ? "RSI" : "", priceScaleId: indicatorScaleSidesRef.current.rsi, color: "#7e57c2", lineWidth: 2, priceLineVisible: false, lastValueVisible: axisLabelsRef.current.studyValues }, paneIndex);
      const upper = chart.addSeries(LineSeries, { priceScaleId: indicatorScaleSidesRef.current.rsi, color: "#596273", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, paneIndex);
      const lower = chart.addSeries(LineSeries, { priceScaleId: indicatorScaleSidesRef.current.rsi, color: "#596273", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, paneIndex);
      rsiSeriesRef.current = { rsi, upper, lower };
      chart.panes()[paneIndex]?.setHeight(140);
      chart.priceScale(indicatorScaleSidesRef.current.rsi, paneIndex).applyOptions({ mode: PriceScaleMode.Normal });
    }

    const volumeVisible = active.has("volume") && !volumeHidden && volumeAllowed;
    volumeSeriesRef.current?.applyOptions({ visible: volumeVisible && volumeVisualSettings.histogramVisible });
    volumeMaSeriesRef.current?.applyOptions({ visible: volumeVisible && volumeMaVisible });
    volumeSmaSeriesRef.current?.applyOptions({ visible: volumeVisible && volumeSmoothedMaVisible });
    const bars = [...barsByTimeRef.current.values()]
      .filter((bar) => isTradingSessionTime(
        bar.time,
        resolution,
        symbolInfo?.session,
        symbolInfo?.timezone,
      ))
      .sort((a, b) => Number(a.time) - Number(b.time));
    updateStudySeries(bars);
    syncPaneLayout();
  }, [syncPaneLayout, transferSeriesGroup, activeStudies, compareSymbols.length, resolution, symbolInfo?.session, symbolInfo?.timezone, volumeMaVisible, volumeSmoothedMaVisible, volumeAllowed, volumeVisualSettings.histogramVisible, volumeHidden]);

  const layoutReady = axisSettingsRestored && appearanceRestored && chartStyleRestored && volumeSettingsRestored && indicatorSettingsRestored && referenceStudies.restored && !historyLoading;
  const flushLayout = useSavedLayout<MovableSeries>({
    storageKey: replayMode ? "backtest.workspaceLayout.v1" : undefined,
    restoreViewport: !replayMode,
    chartRef,
    ready: layoutReady,
    revision: paneRevision + referenceStudies.revision,
    context: replayMode ? `backtest:${symbol}:${replaySession}` : `${symbol}:${resolution}`,
    setRange: setVisiblePriceRange,
    transfer: transferSeriesGroup,
    changed: syncPaneLayout,
    sources: () => {
      const result: { id: string; series: MovableSeries }[] = [];
      const add = (id: string, series: MovableSeries | null | undefined) => { if (series) result.push({ id, series }); };
      add("main", seriesRef.current);
      add("timeline", timelineSeriesRef.current);
      add("volume", volumeSeriesRef.current);
      add("volume:ma", volumeMaSeriesRef.current);
      add("volume:smoothing", volumeSmaSeriesRef.current);
      priceIndicatorSeriesRef.current.forEach((series, id) => add(`study:${id}`, series));
      compareSeriesRef.current.forEach((series, id) => add(`compare:${id}`, series));
      referenceStudies.instances.current.forEach((study) => add(study.id, study.series));
      if (macdSeriesRef.current) Object.entries(macdSeriesRef.current).forEach(([id, series]) => add(`macd:${id}`, series));
      if (rsiSeriesRef.current) Object.entries(rsiSeriesRef.current).forEach(([id, series]) => add(`rsi:${id}`, series));
      return result;
    },
  });

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement !== null);
    onFullscreenChange();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const mainSeries = seriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !mainSeries || !volumeSeries) return;
    // Chỉ số pane trong state có thể chưa đồng bộ sau khi chuyển chuỗi.
    const currentMainPaneIndex = mainSeries.getPane().paneIndex();
    const currentVolumePaneIndex = volumeSeries.getPane().paneIndex();
    const priceScaleId = mainScaleSide;
    const scaleSideChanged = previousMainScaleSideRef.current !== mainScaleSide;
    const visibleTime = scaleSideChanged ? chart.timeScale().getVisibleRange() : null;
    const mode = effectiveScaleMode === "percent"
      ? PriceScaleMode.Percentage
      : effectiveScaleMode === "indexed"
        ? PriceScaleMode.IndexedTo100
        : effectiveScaleMode === "log"
        ? PriceScaleMode.Logarithmic
        : PriceScaleMode.Normal;
    const previousScale = chart.priceScale(previousMainScaleSideRef.current, currentMainPaneIndex);
    const previousMode = previousScale.options().mode;
    const modeChanged = previousMode !== mode;
    const previousPriceRange = scaleSideChanged && !modeChanged && !autoScale
      && previousMode !== PriceScaleMode.Percentage && previousMode !== PriceScaleMode.IndexedTo100
      ? previousScale.getVisibleRange()
      : null;

    seriesRef.current?.applyOptions({
      priceScaleId,
      baseLineVisible: mode === PriceScaleMode.Percentage || mode === PriceScaleMode.IndexedTo100,
      baseLineColor: "#596273",
    });
    compareSeriesRef.current.forEach((series, symbol) => series.applyOptions({ priceScaleId: sourceScaleOverridesRef.current.get(`compare:${symbol}`) ?? priceScaleId }));
    priceIndicatorSeriesRef.current.forEach((series, id) => series.applyOptions({ priceScaleId: sourceScaleOverridesRef.current.get(`study:${id}`) ?? priceScaleId, baseLineVisible: false }));
    if (macdSeriesRef.current) {
      const { histogram, macd, signal } = macdSeriesRef.current;
      [histogram, macd, signal].forEach((item) => item.applyOptions({ priceScaleId: indicatorScaleSides.macd, baseLineVisible: false }));
    }
    if (rsiSeriesRef.current) {
      const { rsi, upper, lower } = rsiSeriesRef.current;
      [rsi, upper, lower].forEach((item) => item.applyOptions({ priceScaleId: indicatorScaleSides.rsi, baseLineVisible: false }));
    }
    const volumeScaleId = volumeScaleSideOverride ?? (currentVolumePaneIndex !== currentMainPaneIndex ? mainScaleSide : comparisonActive ? "volume" : mainScaleSide === "right" ? "left" : "right");
    [volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current].forEach((series) => series?.applyOptions({ baseLineVisible: false }));
    volumeSeriesRef.current?.applyOptions({
      priceScaleId: volumeScaleId,
      visible: activeStudies.includes("volume") && !volumeHidden && volumeAllowed && volumeVisualSettings.histogramVisible,
    });
    volumeMaSeriesRef.current?.applyOptions({
      priceScaleId: volumeScaleId,
      visible: activeStudies.includes("volume") && !volumeHidden && volumeAllowed && volumeMaVisible,
    });
    volumeSmaSeriesRef.current?.applyOptions({
      priceScaleId: volumeScaleId,
      visible: activeStudies.includes("volume") && !volumeHidden && volumeAllowed && volumeSmoothedMaVisible,
    });
    const visibleOtherSourceOn = (side: "left" | "right") =>
      [...compareSeriesRef.current.values(), ...priceIndicatorSeriesRef.current.values()]
        .some((item) => item.options().visible !== false && item.options().priceScaleId === side);
    const volumeAxisVisible = volumeScaleId !== "volume" && [
      volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current,
    ].some((item) => Boolean(item && item.options().visible !== false));
    chart.applyOptions({
      leftPriceScale: {
        visible: mainScaleSide === "left" || secondaryLeftVisible
          || (volumeAxisVisible && volumeScaleId === "left") || visibleOtherSourceOn("left"),
        scaleMargins: mainScaleSide === "left"
          ? { top: chartAppearance.topMargin / 100, bottom: chartAppearance.bottomMargin / 100 }
          : { top: 0.02, bottom: 0 },
      },
      rightPriceScale: {
        visible: mainScaleSide === "right" || secondaryRightVisible
          || (volumeAxisVisible && volumeScaleId === "right") || visibleOtherSourceOn("right"),
        scaleMargins: mainScaleSide === "right"
          ? { top: chartAppearance.topMargin / 100, bottom: chartAppearance.bottomMargin / 100 }
          : { top: 0.02, bottom: 0 },
      },
    });

    if (volumeScaleId === "volume") volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    else if (currentVolumePaneIndex !== currentMainPaneIndex) volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.05 }, visible: true });

    const priceScale = mainSeries.priceScale();
    applyPriceScaleMode(chart, priceScale, mode);
    priceScale.applyOptions({
      invertScale: mainScaleInverted,
    });
    priceScale.setAutoScale(mode === PriceScaleMode.Percentage || mode === PriceScaleMode.IndexedTo100 || (autoScale && !scaleLocked));
    if (scaleSideChanged) {
      const oldScale = chart.priceScale(previousMainScaleSideRef.current, currentMainPaneIndex);
      applyPriceScaleMode(chart, oldScale, PriceScaleMode.Normal);
      oldScale.applyOptions({ invertScale: false });
      previousMainScaleSideRef.current = mainScaleSide;
      if (visibleTime) chart.timeScale().setVisibleRange(visibleTime);
      if (previousPriceRange) setVisiblePriceRange(priceScale, previousPriceRange);
    }
  }, [activeStudies, autoScale, comparisonActive, effectiveScaleMode, mainScaleSide, mainScaleInverted, mainPaneIndex, scaleLocked, secondaryLeftVisible, secondaryRightVisible, volumeMaVisible, volumeSmoothedMaVisible, volumeAllowed, volumeVisualSettings.histogramVisible, volumeHidden, volumePaneIndex, volumeScaleSideOverride, paneRevision, indicatorScaleSides.macd, indicatorScaleSides.rsi, chartAppearance.topMargin, chartAppearance.bottomMargin]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !axisSettingsRestored) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveRange = () => {
      if (chartRef.current !== chart || loadedAxisContextRef.current !== `${symbol}:${resolution}`) return;
      const paneIndex = seriesRef.current?.getPane().paneIndex();
      if (paneIndex === undefined) return;
      const scale = chart.priceScale(mainScaleSideRef.current, paneIndex);
      const options = scale.options();
      if (options.autoScale || options.mode === PriceScaleMode.Percentage || options.mode === PriceScaleMode.IndexedTo100) return;
      const range = scale.getVisibleRange();
      if (range) writeManualAxisRange(symbol, resolution, options.mode === PriceScaleMode.Logarithmic ? "log" : "normal", range);
    };
    const scheduleSave = () => {
      clearTimeout(timer);
      timer = setTimeout(saveRange, 150);
    };
    scheduleSave();
    window.addEventListener("pointerup", scheduleSave);
    window.addEventListener("wheel", scheduleSave, { passive: true });
    window.addEventListener("pagehide", saveRange);
    document.addEventListener("visibilitychange", saveRange);
    return () => {
      clearTimeout(timer);
      saveRange();
      window.removeEventListener("pointerup", scheduleSave);
      window.removeEventListener("wheel", scheduleSave);
      window.removeEventListener("pagehide", saveRange);
      document.removeEventListener("visibilitychange", saveRange);
    };
  }, [axisSettingsRestored, symbol, resolution, scaleMode, autoScale, scaleLocked, mainScaleSide, mainPaneIndex, paneRevision, historyLoading]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const { backgroundColor, gridColor, gridVisible, crosshairColor, textColor, fontSize, topMargin, bottomMargin, rightMargin } = chartAppearance;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: backgroundColor }, textColor, fontSize },
      grid: { vertLines: { color: gridVisible ? gridColor : backgroundColor }, horzLines: { color: gridVisible ? gridColor : backgroundColor } },
      crosshair: { vertLine: { color: crosshairColor }, horzLine: { color: crosshairColor } },
    });
    chart.timeScale().applyOptions({ rightOffset: rightMargin });
    chart.priceScale(mainScaleSide, mainPaneIndex).applyOptions({ scaleMargins: { top: topMargin / 100, bottom: bottomMargin / 100 } });
  }, [chartAppearance, mainScaleSide, mainPaneIndex, comparisonActive]);

  useEffect(() => {
    chartStyleRendererRef.current?.configure(chartStyle, chartStylePreferences.settings[chartStyle] ?? defaultStyleSettings(chartStyle), chartAppearance.backgroundColor);
    setVisibleBar((current) => current ? { ...current } : currentBarRef.current);
    updateStudySeries([...barsByTimeRef.current.values()].sort((a, b) => Number(a.time) - Number(b.time)));
    refreshSelectionMarkersRef.current();
    refreshHighLowRef.current();
  }, [chartStyle, chartStylePreferences.settings, chartAppearance.backgroundColor]);

  useEffect(() => {
    seriesRef.current?.applyOptions({ visible: mainSeriesVisible });
  }, [mainSeriesVisible]);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    const pane = seriesRef.current?.getPane();
    if (!chart || !container || !pane) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const activePane = seriesRef.current?.getPane();
        const paneElement = activePane?.getHTMLElement();
        if (!activePane || !paneElement || !container.parentElement) return;
        const index = activePane.paneIndex();
        const scaleWidth = (side: "left" | "right") => {
          try { return chart.priceScale(side, index).width(); }
          catch { return 0; }
        };
        const plotTop = (source?: MovableSeries | null) =>
          source?.getPane().getHTMLElement()?.getBoundingClientRect().top ?? paneElement.getBoundingClientRect().top;
        const rootTop = container.parentElement.getBoundingClientRect().top;
        const sourceTops: Record<string, number> = {};
        referenceStudies.instances.current.forEach((study) => { if (study.series) sourceTops[study.id] = plotTop(study.series) - rootTop; });
        compareSeriesRef.current.forEach((source, symbol) => { sourceTops[`compare:${symbol}`] = plotTop(source) - rootTop; });
        priceIndicatorSeriesRef.current.forEach((source, id) => { sourceTops[`study:${id}`] = plotTop(source) - rootTop; });
        if (macdSeriesRef.current) sourceTops["study:macd"] = plotTop(macdSeriesRef.current.macd) - rootTop;
        if (rsiSeriesRef.current) sourceTops["study:rsi"] = plotTop(rsiSeriesRef.current.rsi) - rootTop;
        const next = {
          left: scaleWidth("left"),
          right: scaleWidth("right"),
          top: paneElement.getBoundingClientRect().top - rootTop,
          comparisonTop: plotTop(compareSeriesRef.current.values().next().value) - rootTop,
          volumeTop: plotTop(volumeSeriesRef.current) - rootTop,
          sourceTops,
        };
        setLegendBounds((current) => current.left === next.left && current.right === next.right && current.top === next.top && current.comparisonTop === next.comparisonTop && current.volumeTop === next.volumeTop && Object.keys(current.sourceTops).length === Object.keys(sourceTops).length && Object.entries(sourceTops).every(([key, value]) => current.sourceTops[key] === value) ? current : next);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    chart.panes().forEach((currentPane) => {
      const currentElement = currentPane.getHTMLElement();
      if (currentElement) observer.observe(currentElement);
    });
    chart.timeScale().subscribeSizeChange(update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.timeScale().unsubscribeSizeChange(update);
    };
  }, [mainPaneIndex, mainScaleSide, comparisonActive, volumePaneIndex, paneRevision, activeStudies, compareSymbols, referenceStudies.revision]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions({
      title: axisLabels.symbol ? symbol : "",
      lastValueVisible: axisLabels.seriesValue,
      priceLineVisible: axisLines.price && chartAppearance.lastPriceVisible,
    });
    compareSeriesRef.current.forEach((compareSeries, compareSymbol) => compareSeries.applyOptions({
      title: axisLabels.symbol ? compareSymbol : "",
      lastValueVisible: axisLabels.seriesValue,
      priceLineVisible: comparisonSettingsRef.current[compareSymbol]?.priceLine ?? false,
    }));
    priceIndicatorSeriesRef.current.forEach((studySeries, id) => studySeries.applyOptions({
      title: axisLabels.studyNames ? id : "",
      lastValueVisible: axisLabels.studyValues,
    }));
    const macd = macdSeriesRef.current;
    macd?.histogram.applyOptions({ title: axisLabels.studyNames ? "Histogram" : "", lastValueVisible: axisLabels.studyValues });
    macd?.macd.applyOptions({ title: axisLabels.studyNames ? "MACD" : "", lastValueVisible: axisLabels.studyValues });
    macd?.signal.applyOptions({ title: axisLabels.studyNames ? "Signal" : "", lastValueVisible: axisLabels.studyValues });
    const rsi = rsiSeriesRef.current;
    rsi?.rsi.applyOptions({ title: axisLabels.studyNames ? "RSI" : "", lastValueVisible: axisLabels.studyValues });
    volumeSeriesRef.current?.applyOptions({ title: axisLabels.studyNames ? "Volume" : "", lastValueVisible: false });
    volumeMaSeriesRef.current?.applyOptions({ title: axisLabels.studyNames ? "Volume MA" : "", lastValueVisible: false });
    volumeSmaSeriesRef.current?.applyOptions({ title: axisLabels.studyNames ? "Smoothed MA" : "", lastValueVisible: false });
    referenceStudies.instances.current.forEach((study) => {
      const plots = study.definition?.metainfo.plots.filter((plot) => {
        const style = study.settings?.styles[plot.id];
        return plot.type === "line" && style && style.visible !== false && style.display !== 0 && (style.trackPrice || study.settings?.scaleLabels) && study.points.some((point) => Number.isFinite(point.values[plot.id]));
      }) ?? [];
      study.priceLines?.forEach((line, index) => line.applyOptions({
        axisLabelVisible: Boolean(study.settings?.scaleLabels && study.series && studyLabelsVisible(study.series)),
        title: axisLabels.studyNames && plots[index] ? study.definition?.metainfo.styles[plots[index].id]?.title ?? study.name : "",
      }));
    });
    chartRef.current?.priceScale(mainScaleSide, mainPaneIndex).applyOptions({ alignLabels: axisLabels.align });
  }, [axisLabels, axisLines.price, chartAppearance.lastPriceVisible, mainScaleSide, mainPaneIndex, symbol, volumeVisualSettings.scaleLabelVisible, referenceStudies.revision, studyLabelsVisible]);

  useEffect(() => {
    const main = seriesRef.current;
    if (!main) return;
    chartRef.current?.panes().forEach((pane) => pane.getSeries().forEach((series) => {
      if (series === main) return;
      const sharesMainScale = pane === main.getPane() && series.options().priceScaleId === main.options().priceScaleId;
      series.applyOptions({ autoscaleInfoProvider: seriesOnlyScale && sharesMainScale ? () => null : undefined });
    }));
  }, [seriesOnlyScale, activeStudies, compareSymbols.length, mainScaleSide, mainPaneIndex, paneRevision, referenceStudies.revision]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    let cached: { from: number; to: number; high: number; low: number; bar?: Bar } | undefined;
    const update = (tickBar?: Bar) => {
      if (!axisLabels.highLow && !axisLines.highLow) {
        if (highLowLinesRef.current && (highLowLinesRef.current.high.options().axisLabelVisible || highLowLinesRef.current.high.options().lineVisible)) {
          highLowLinesRef.current.high.applyOptions({ axisLabelVisible: false, lineVisible: false });
          highLowLinesRef.current.low.applyOptions({ axisLabelVisible: false, lineVisible: false });
        }
        return;
      }
      const visible = chart.timeScale().getVisibleRange();
      const from = visible ? Number(visible.from) : -Infinity;
      const to = visible ? Number(visible.to) : Infinity;
      let high = -Infinity, low = Infinity;
      if (tickBar && cached && cached.from === from && cached.to === to
        && cached.bar?.time === tickBar.time && tickBar.high >= cached.bar.high && tickBar.low <= cached.bar.low) {
        high = cached.high; low = cached.low;
        if (Number(tickBar.time) >= from && Number(tickBar.time) <= to) {
          high = Math.max(high, tickBar.high); low = Math.min(low, tickBar.low);
        }
      } else {
        for (const bar of barsByTimeRef.current.values()) {
          if (Number(bar.time) < from || Number(bar.time) > to) continue;
          high = Math.max(high, bar.high); low = Math.min(low, bar.low);
        }
      }
      cached = { from, to, high, low, bar: tickBar };
      if (!Number.isFinite(high) || !Number.isFinite(low)) {
        highLowLinesRef.current?.high.applyOptions({ axisLabelVisible: false, lineVisible: false });
        highLowLinesRef.current?.low.applyOptions({ axisLabelVisible: false, lineVisible: false });
        return;
      }
      if (!highLowLinesRef.current) {
        highLowLinesRef.current = {
          high: series.createPriceLine({ price: high, color: "#142E61", lineWidth: 1, lineStyle: 2, lineVisible: false, axisLabelVisible: false, title: "Đỉnh" }),
          low: series.createPriceLine({ price: low, color: "#142E61", lineWidth: 1, lineStyle: 2, lineVisible: false, axisLabelVisible: false, title: "Đáy" }),
        };
      }
      if (highLowLinesRef.current.high.options().price !== high || highLowLinesRef.current.high.options().axisLabelVisible !== axisLabels.highLow || highLowLinesRef.current.high.options().lineVisible !== axisLines.highLow) highLowLinesRef.current.high.applyOptions({ price: high, axisLabelVisible: axisLabels.highLow, lineVisible: axisLines.highLow });
      if (highLowLinesRef.current.low.options().price !== low || highLowLinesRef.current.low.options().axisLabelVisible !== axisLabels.highLow || highLowLinesRef.current.low.options().lineVisible !== axisLines.highLow) highLowLinesRef.current.low.applyOptions({ price: low, axisLabelVisible: axisLabels.highLow, lineVisible: axisLines.highLow });
    };
    refreshHighLowRef.current = update;
    const onRange = () => update();
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    update();
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
      refreshHighLowRef.current = () => undefined;
    };
  }, [axisLabels.highLow, axisLines.highLow, resolution, symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !scaleLocked || loadedAxisContextRef.current !== `${symbol}:${resolution}`) {
      scaleRatioRef.current = null;
      return;
    }
    const scale = chart.priceScale(mainScaleSide, mainPaneIndex);
    const initialRange = scale.getVisibleRange();
    if (!initialRange) return;
    const internalHeight = () => Math.max(1, chart.panes()[mainPaneIndex].getHeight() * (1 - scale.options().scaleMargins.top - scale.options().scaleMargins.bottom));
    scaleRatioRef.current = chart.timeScale().options().barSpacing * (initialRange.to - initialRange.from) / internalHeight();
    const preserveRatio = () => {
      if (!renderingRef.current) return;
      const range = scale.getVisibleRange();
      const ratio = scaleRatioRef.current;
      if (!range || ratio === null) return;
      const span = ratio * internalHeight() / Math.max(1e-10, chart.timeScale().options().barSpacing);
      const center = (range.from + range.to) / 2;
      setVisiblePriceRange(scale, { from: center - span / 2, to: center + span / 2 });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(preserveRatio);
    window.addEventListener("resize", preserveRatio);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(preserveRatio);
      window.removeEventListener("resize", preserveRatio);
    };
  }, [mainScaleSide, mainPaneIndex, scaleLocked, paneRevision, historyLoading, symbol, resolution]);

  useEffect(() => {
    lineToolsRef.current?.setLocked(drawingsLocked);
  }, [drawingsLocked]);

  useEffect(() => {
    lineToolsRef.current?.setMagnetThreshold(magnetMode === 0 ? 0 : magnetMode === 1 ? 10 : 24);
  }, [magnetMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const scale = chartRef.current?.priceScale(mainScaleSide, mainPaneIndex);
        const key = event.key.toLowerCase();
        if (scale && ["r", "p", "l", "i"].includes(key)) {
          event.preventDefault();
          if (key === "r") {
            resetChartView();
          } else if (key === "i") {
            setMainScaleInverted((current) => !current);
          } else {
            if (scaleLockedRef.current) return;
            const mode: ScaleMode = key === "p"
              ? effectiveScaleMode === "percent" ? "normal" : "percent"
              : effectiveScaleMode === "log" ? "normal" : "log";
            setMainScaleMode(mode);
          }
          return;
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const beforeDelete = lineToolsRef.current?.exportLineTools();
        lineToolsRef.current?.removeSelectedLineTools();
        if (lineToolsRef.current) {
          const drawingState = lineToolsRef.current.exportLineTools();
          if (beforeDelete !== drawingState) recordDrawingState(drawingState);
        }
      }
      const modifierPressed = (event.ctrlKey || event.metaKey) && !event.altKey;
      const key = event.key.toLowerCase();
      if (modifierPressed && key === "z" && !event.shiftKey) {
        event.preventDefault();
        ensureDrawingHistoryDay();
        if (drawingHistoryRef.current.length > 1) {
          const currentState = drawingHistoryRef.current.pop()!;
          drawingRedoHistoryRef.current.push(currentState);
          drawingRedoHistoryRef.current = drawingRedoHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
          restoreDrawingState(drawingHistoryRef.current.at(-1) ?? "[]");
          syncDrawingHistoryAvailability();
        }
      }
      if (modifierPressed && key === "y" && !event.shiftKey) {
        event.preventDefault();
        ensureDrawingHistoryDay();
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
  }, [effectiveScaleMode, mainScaleSide, mainPaneIndex, recordDrawingState, restoreDrawingState, setMainScaleMode, syncDrawingHistoryAvailability, ensureDrawingHistoryDay, resetChartView]);

  const closeAxisMenu = useCallback(() => setAxisMenu(null), []);
  const closeChartMenu = useCallback(() => setChartMenu(null), []);
  const axisAtPoint = (clientX: number, clientY: number) => {
    const chart = chartRef.current;
    const element = containerRef.current;
    if (!chart || !element) return null;
    const rect = element.getBoundingClientRect();
    const paneIndex = chart.panes().findIndex((pane) => {
      const paneRect = pane.getHTMLElement()?.getBoundingClientRect();
      return paneRect && clientY >= paneRect.top && clientY < paneRect.bottom;
    });
    if (paneIndex < 0) return null;
    const leftWidth = safePriceScaleWidth(chart, "left", paneIndex);
    const rightWidth = safePriceScaleWidth(chart, "right", paneIndex);
    const x = clientX - rect.left;
    const side: "left" | "right" | null = leftWidth > 0 && x <= leftWidth
      ? "left"
      : rightWidth > 0 && x >= rect.width - rightWidth
        ? "right"
        : null;
    if (!side) return null;
    const hasSeriesOnAxis = chart.panes()[paneIndex].getSeries().some((series) =>
      (series.options().priceScaleId ?? "right") === side,
    );
    if (!hasSeriesOnAxis) return null;
    return { side, paneIndex, width: side === "left" ? leftWidth : rightWidth, axisLeft: side === "left" ? rect.left : rect.right - rightWidth, paneBottom: chart.panes()[paneIndex].getHTMLElement()!.getBoundingClientRect().bottom };
  };
  const onAxisHover = (event: React.MouseEvent<HTMLElement>) => {
    const axis = axisAtPoint(event.clientX, event.clientY);
    const element = containerRef.current;
    const chart = chartRef.current;
    if (element && chart) {
      const rect = element.getBoundingClientRect();
      const onCanvas = event.target instanceof HTMLCanvasElement;
      const onTimeAxis = event.clientY >= rect.bottom - chart.timeScale().height() && event.clientY < rect.bottom;
      const cursor = onCanvas && axis ? "price" : onCanvas && onTimeAxis ? "time" : "";
      if (element.dataset.axisCursor !== cursor) element.dataset.axisCursor = cursor;
    }
    if (!axis) {
      setHoverAxis((current) => current ? null : current);
      return;
    }
    const stageRect = containerRef.current!.parentElement!.getBoundingClientRect();
    const next = {
      side: axis.side,
      paneIndex: axis.paneIndex,
      left: axis.axisLeft - stageRect.left,
      top: axis.paneBottom - stageRect.top - 30,
      width: axis.width,
    };
    setFooterAxis((current) => current?.side === axis.side && current.paneIndex === axis.paneIndex
      ? current : { side: axis.side, paneIndex: axis.paneIndex });
    setHoverAxis((current) => current
      && current.side === next.side
      && current.paneIndex === next.paneIndex
      && current.left === next.left
      && current.top === next.top
      && current.width === next.width ? current : next);
  };
  const onAxisContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const axis = axisAtPoint(event.clientX, event.clientY);
    event.preventDefault();
    event.stopPropagation();
    setChartMenu(null);
    setAxisMenu(null);
    if (axis) {
      setFooterAxis({ side: axis.side, paneIndex: axis.paneIndex });
      setAxisMenu({ x: event.clientX, y: event.clientY, side: axis.side, paneIndex: axis.paneIndex });
      return;
    }
    const chart = chartRef.current;
    const element = containerRef.current;
    const mainSeries = seriesRef.current;
    if (!chart || !element || !mainSeries) return;
    const pane = chart.panes().find((pane) => {
      const rect = pane.getHTMLElement()?.getBoundingClientRect();
      return rect && event.clientY >= rect.top && event.clientY < rect.bottom;
    });
    const rect = pane?.getHTMLElement()?.getBoundingClientRect();
    if (!pane || !rect) return;
    const paneIndex = pane.paneIndex();
    const source = paneIndex === mainPaneIndexRef.current ? mainSeries : pane.getSeries().find((series) => series.options().visible && series.data().length > 0);
    const localY = event.clientY - rect.top;
    const coordinatePrice = source?.coordinateToPrice(localY);
    const price = coordinatePrice != null && Number.isFinite(coordinatePrice) ? coordinatePrice : null;
    const leftWidth = safePriceScaleWidth(chart, "left", paneIndex);
    const time = chart.timeScale().coordinateToTime(event.clientX - element.getBoundingClientRect().left - leftWidth);
    const current = currentBarRef.current;
    const priceLineY = current && mainSeries.priceToCoordinate(chartStyleRendererRef.current?.displayPrice(current) ?? current.close);
    const hovered = hoveredMainSeriesRef.current;
    const localX = event.clientX - element.getBoundingClientRect().left - leftWidth;
    const hitMainSeries = hovered?.paneIndex === paneIndex && Math.abs(hovered.x - localX) <= 2 && Math.abs(hovered.y - localY) <= 2;
    if (price !== null && paneIndex === mainPaneIndexRef.current && mainSeriesVisible && (hitMainSeries || (axisLines.price && priceLineY != null && Math.abs(localY - priceLineY) <= 5))) {
      setSelectedLegend("instrument");
      element.dispatchEvent(new CustomEvent("chart-series-contextmenu", { detail: { x: event.clientX, y: event.clientY, price } }));
      return;
    }
    setChartMenu({ x: event.clientX, y: event.clientY, price, time: typeof time === "number" ? time : null, paneIndex });
  };

  const toggleHoverAxisMode = (mode: "auto" | "log") => {
    const chart = chartRef.current;
    if (!chart || !hoverAxis) return;
    const scale = chart.priceScale(hoverAxis.side, hoverAxis.paneIndex);
    const isMainAxis = hoverAxis.paneIndex === mainPaneIndex && hoverAxis.side === mainScaleSide;
    if (mode === "auto") {
      if (scale.options().mode === PriceScaleMode.Percentage || scale.options().mode === PriceScaleMode.IndexedTo100 || (isMainAxis && scaleLocked)) return;
      if (isMainAxis) toggleMainAutoScale();
      else scale.setAutoScale(!scale.options().autoScale);
    } else if (isMainAxis) {
      if (scaleLocked) return;
      const next: ScaleMode = effectiveScaleMode === "log" ? "normal" : "log";
      setMainScaleMode(next);
    } else {
      applyPriceScaleMode(chart, scale, scale.options().mode === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic);
    }
    setHoverAxis((current) => current ? { ...current } : current);
  };

  const runAxisMenuAction = (action: PriceAxisMenuAction) => {
    const chart = chartRef.current;
    if (!chart || !axisMenu) return;
    const { side, paneIndex } = axisMenu;
    const scale = chart.priceScale(side, paneIndex);
    const isMainAxis = paneIndex === mainPaneIndex && side === mainScaleSide;
    switch (action) {
      case "reset":
        if (isMainAxis) {
          setScaleLocked(false);
          setAutoScale(true);
        }
        scale.setAutoScale(true);
        break;
      case "auto":
        if (scale.options().mode === PriceScaleMode.Percentage || scale.options().mode === PriceScaleMode.IndexedTo100 || (isMainAxis && scaleLocked)) break;
        if (isMainAxis) toggleMainAutoScale();
        else scale.setAutoScale(!scale.options().autoScale);
        break;
      case "lock":
        if (isMainAxis) {
          if (!scaleLocked) {
            setMainScaleMode("normal");
            applyPriceScaleMode(chart, scale, PriceScaleMode.Normal);
            setAutoScale(false);
          }
          setScaleLocked(!scaleLocked);
        }
        break;
      case "seriesOnly":
        setSeriesOnlyScale((current) => !current);
        break;
      case "invert":
        if (isMainAxis) setMainScaleInverted(!mainScaleInverted);
        else scale.applyOptions({ invertScale: !scale.options().invertScale });
        break;
      case "normal":
      case "percent":
      case "indexed":
      case "log": {
        if (isMainAxis && scaleLocked) break;
        const requestedMode = action === "normal" ? PriceScaleMode.Normal
          : action === "percent" ? PriceScaleMode.Percentage
            : action === "indexed" ? PriceScaleMode.IndexedTo100
              : PriceScaleMode.Logarithmic;
        const mode = requestedMode === scale.options().mode ? PriceScaleMode.Normal : requestedMode;
        if (isMainAxis) setMainScaleMode(mode === PriceScaleMode.Normal ? "normal" : action);
        else applyPriceScaleMode(chart, scale, mode);
        break;
      }
      case "move": {
        const destination = side === "left" ? "right" : "left";
        const panes = chart.panes();
        const volumeWasOnSelectedSide = volumeSeriesRef.current?.options().priceScaleId === side;
        panes.forEach((pane) => {
          pane.getSeries().forEach((paneSeries) => {
            if ((paneSeries.options().priceScaleId ?? "right") === side) {
              paneSeries.applyOptions({ priceScaleId: destination });
            }
          });
        });
        if (mainScaleSideRef.current === side) setScaleSideOverride(destination);
        if (volumeWasOnSelectedSide) setVolumeScaleSideOverride(destination);
        setIndicatorScaleSideOverrides((current) => ({
          macd: indicatorScaleSidesRef.current.macd === side ? destination : current.macd,
          rsi: indicatorScaleSidesRef.current.rsi === side ? destination : current.rsi,
        }));
        sourceScaleOverridesRef.current.forEach((scaleSide, sourceId) => {
          if (scaleSide === side) sourceScaleOverridesRef.current.set(sourceId, destination);
        });
        const visibleSides = new Set<"left" | "right">();
        const paneVisibleSides = panes.map((pane) => {
          const sides = new Set(
            pane.getSeries()
              .filter((paneSeries) => paneSeries.options().visible !== false)
              .map((paneSeries) => paneSeries.options().priceScaleId ?? "right"),
          );
          if (sides.has("left")) visibleSides.add("left");
          if (sides.has("right")) visibleSides.add("right");
          return sides;
        });
        chart.applyOptions({
          leftPriceScale: { visible: visibleSides.has("left") },
          rightPriceScale: { visible: visibleSides.has("right") },
        });
        paneVisibleSides.forEach((sides, index) => {
          chart.priceScale("left", index).applyOptions({ visible: sides.has("left") });
          chart.priceScale("right", index).applyOptions({ visible: sides.has("right") });
        });
        setPaneRevision((current) => current + 1);
        break;
      }
      case "symbolLabels": setAxisLabels((current) => ({ ...current, symbol: !current.symbol })); break;
      case "seriesValue": setAxisLabels((current) => ({ ...current, seriesValue: !current.seriesValue })); break;
      case "highLowLabels": setAxisLabels((current) => ({ ...current, highLow: !current.highLow })); break;
      case "studyNames": setAxisLabels((current) => ({ ...current, studyNames: !current.studyNames })); break;
      case "studyValues": setAxisLabels((current) => ({ ...current, studyValues: !current.studyValues })); break;
      case "alignLabels":
        scale.applyOptions({ alignLabels: !scale.options().alignLabels });
        if (isMainAxis) setAxisLabels((current) => ({ ...current, align: !current.align }));
        break;
      case "priceLine": setAxisLines((current) => ({ ...current, price: !current.price })); break;
      case "highLowLines": setAxisLines((current) => ({ ...current, highLow: !current.highLow })); break;
      case "countdown": setCountdownVisible((current) => !current); break;
    }
  };

  useEffect(() => {
    if (!active || !documentVisible || !countdownVisible) {
      setCountdown(null);
      return;
    }
    const update = () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const bar = currentBarRef.current ?? [...barsByTimeRef.current.values()].at(-1);
      const now = replayRef.current?.frame?.cutoff ?? Date.now() / 1000;
      if (!chart || !series || !bar || !isTradingSessionTime(now as Bar["time"], "1", symbolInfo?.session, symbolInfo?.timezone)) {
        setCountdown(null);
        return;
      }
      const text = barCloseCountdown(Number(bar.time), resolution, now);
      const coordinate = series.priceToCoordinate(bar.close);
      if (!text || coordinate === null) {
        setCountdown(null);
        return;
      }
      const paneTop = series.getPane().getHTMLElement()?.getBoundingClientRect().top;
      const stageTop = containerRef.current?.parentElement?.getBoundingClientRect().top;
      setCountdown({ text, top: (paneTop !== undefined && stageTop !== undefined ? paneTop - stageTop : 0) + coordinate + 12 });
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, documentVisible, countdownVisible, resolution, symbolInfo?.session, symbolInfo?.timezone, replayCutoff]);

  const startDrawing = (type: LineToolType) => {
    if (drawingsLocked || !lineToolsRef.current) return;
    zoomModeRef.current = false;
    zoomStartRef.current = null;
    setZoomMode(false);
    setZoomSelection(null);
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
    zoomModeRef.current = false;
    zoomStartRef.current = null;
    setZoomMode(false);
    setZoomSelection(null);
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

  const toggleZoomMode = () => {
    const active = zoomModeRef.current;
    selectCursor();
    if (active) return;
    zoomModeRef.current = true;
    setZoomMode(true);
    chartRef.current?.applyOptions({ handleScroll: { pressedMouseMove: false } });
  };

  const undoZoom = () => {
    ensureDrawingHistoryDay();
    const previous = zoomHistoryRef.current.pop();
    const chart = chartRef.current;
    if (!previous || !chart) return;
    const timeScale = chart.timeScale();
    const current = timeScale.getVisibleLogicalRange();
    if (current) {
      timeScale.applyOptions({ barSpacing: previous.barSpacing });
      timeScale.setVisibleLogicalRange({
        from: current.from + previous.leftOffset,
        to: current.to + previous.rightOffset,
      });
    }
    const priceScale = chart.priceScale(mainScaleSideRef.current, mainPaneIndexRef.current);
    followLatestRef.current = previous.followLatest;
    if (previous.autoScale || previous.priceScaleMode !== priceScale.options().mode
      || priceScale.options().mode === PriceScaleMode.Percentage || priceScale.options().mode === PriceScaleMode.IndexedTo100) {
      autoScaleRef.current = true;
      setAutoScale(true);
      priceScale.setAutoScale(true);
    } else if (previous.priceRange) {
      autoScaleRef.current = false;
      setAutoScale(false);
      setVisiblePriceRange(priceScale, previous.priceRange);
    }
    setZoomHistoryCount(zoomHistoryRef.current.length);
  };

  const clearDrawings = () => {
    lineToolsRef.current?.removeAllLineTools();
    hiddenDrawingsRef.current = null;
    setDrawingsHidden(false);
    recordDrawingState("[]");
    if (drawingKeyRef.current) localStorage.removeItem(drawingKeyRef.current);
  };

  const clearIndicators = () => { setActiveStudies([]); setCompareSymbols([]); referenceStudies.clear(); setSelectedLegend(null); };

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
    const lineTools = lineToolsRef.current;
    if (!lineTools || lineTools.getLineToolByID(drawing.id) === "[]") return;
    lineTools.createOrUpdateLineTool(drawing.toolType, drawing.points, drawing.options, drawing.id);
    saveDrawingDefaults(drawing);
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

  const currentPriceFormat = symbolInfo
    ? symbolPriceFormat(symbolInfo)
    : { type: "price" as const, precision: 2, minMove: 0.01 };
  const latestVolumeValue = () => {
    if (volumeHistory.current !== barsByTimeRef.current) {
      streamingVolume.current.reset([...barsByTimeRef.current.values()].filter((bar) =>
        isTradingSessionTime(bar.time, resolution, symbolInfo?.session, symbolInfo?.timezone)
      ).sort((a, b) => Number(a.time) - Number(b.time)));
      volumeHistory.current = barsByTimeRef.current;
    }
    return streamingVolume.current.volume(maLength, maType, smoothingLength)?.value;
  };
  const drawingToolbarAnchor = (() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const chartElement = containerRef.current;
    if (!selectedDrawing || !chart || !series || !chartElement) return null;
    const pane = series.getPane();
    const chartRect = chartElement.getBoundingClientRect();
    const paneTop = (pane.getHTMLElement()?.getBoundingClientRect().top ?? chartRect.top) - chartRect.top;
    const leftInset = safePriceScaleWidth(chart, "left", pane.paneIndex());
    const coordinates = selectedDrawing.points.flatMap((point) => {
      const logical = interpolateLogicalIndexFromTime(chart, series, point.timestamp as Time);
      const x = logical === null ? null : logicalIndexToCoordinate(chart.timeScale(), logical);
      const y = series.priceToCoordinate(point.price);
      return x === null || y === null ? [] : [{ x: x + leftInset, y: chartElement.offsetTop + paneTop + y }];
    });
    if (!coordinates.length) return null;
    const xValues = coordinates.map((point) => point.x);
    const yValues = coordinates.map((point) => point.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    let drawingTop = minY;
    let drawingBottom = maxY;
    if (selectedDrawing.toolType === "PriceLabel") {
      drawingTop -= selectedDrawing.options.text.font.size + 25;
    } else if (selectedDrawing.toolType === "PriceNote" && coordinates.length > 1) {
      const [origin, label] = coordinates;
      const angle = Math.round(180 * Math.atan2(label.y - origin.y, label.x - origin.x) / Math.PI);
      const height = selectedDrawing.options.text.font.size + 12;
      const labelTop = angle >= -135 && angle <= -45 ? label.y - height : angle >= 45 && angle <= 135 ? label.y : label.y - height / 2;
      drawingTop = Math.min(drawingTop, labelTop);
      drawingBottom = Math.max(drawingBottom, labelTop + height);
    }

    const isTextBearingTool = selectedDrawing.toolType === "Text" || selectedDrawing.toolType === "Callout";
    let textAnchor: { x: number; y: number } | undefined;
    if (isTextBearingTool) {
      const targetPoint = selectedDrawing.toolType === "Callout" && selectedDrawing.points.length > 1
        ? selectedDrawing.points[1]
        : selectedDrawing.points[0];
      const targetLogical = interpolateLogicalIndexFromTime(chart, series, targetPoint.timestamp as Time);
      const targetX = targetLogical === null ? null : logicalIndexToCoordinate(chart.timeScale(), targetLogical);
      const targetY = series.priceToCoordinate(targetPoint.price);
      if (targetX !== null && targetY !== null) {
        textAnchor = { x: targetX + leftInset, y: chartElement.offsetTop + paneTop + targetY };
      }
    }

    return {
      centerX: (minX + maxX) / 2,
      top: drawingTop,
      bottom: drawingBottom,
      left: minX,
      right: maxX,
      textAnchor,
    };
  })();

  const applyRangePreset = (preset?: RangePreset) => {
    if (replayMode) return;
    if (preset && rangeDays === preset.days) {
      setRangeDays(undefined);
      return;
    }
    setRangeDays(preset?.days);
    if (preset) setResolution(preset.resolution);
  };

  const toggleStudy = (id: StudyId) => {
    setActiveStudies((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const downloadSnapshot = () => {
    const canvas = captureChartCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${symbol}-${resolution}-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.getElementById(replayMode ? "backtest-chart-app" : "app")?.requestFullscreen();
  };

  const handleUndo = useCallback(() => {
    ensureDrawingHistoryDay();
    if (drawingHistoryRef.current.length <= 1 || !lineToolsRef.current) return;
    const currentState = drawingHistoryRef.current.pop()!;
    drawingRedoHistoryRef.current.push(currentState);
    drawingRedoHistoryRef.current = drawingRedoHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
    const prevState = drawingHistoryRef.current.at(-1) ?? "[]";
    restoreDrawingState(prevState);
    syncDrawingHistoryAvailability();
  }, [restoreDrawingState, syncDrawingHistoryAvailability, ensureDrawingHistoryDay]);

  const handleRedo = useCallback(() => {
    ensureDrawingHistoryDay();
    if (drawingRedoHistoryRef.current.length === 0 || !lineToolsRef.current) return;
    const nextState = drawingRedoHistoryRef.current.pop()!;
    drawingHistoryRef.current.push(nextState);
    drawingHistoryRef.current = drawingHistoryRef.current.slice(-MAX_DRAWING_HISTORY_STATES);
    restoreDrawingState(nextState);
    syncDrawingHistoryAvailability();
  }, [restoreDrawingState, syncDrawingHistoryAvailability, ensureDrawingHistoryDay]);

  const pasteMainPrice = async () => {
    const plugin = lineToolsRef.current;
    if (!plugin || drawingsLocked) return;
    let serialized = drawingClipboardRef.current;
    try {
      serialized = await navigator.clipboard.readText();
    } catch {}
    if (!serialized) return;
    try {
      const drawings = JSON.parse(normalizeDrawingState(serialized)) as LineToolExport<LineToolType>[];
      const supported = new Set(DRAWING_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.id)));
      if (!Array.isArray(drawings) || !drawings.length || drawings.some((drawing) => !drawing || !supported.has(drawing.toolType)
        || !Array.isArray(drawing.points) || !drawing.points.every((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price)) || !drawing.options)) return;
      selectCursor();
      if (drawingsHiddenRef.current && hiddenDrawingsRef.current) {
        plugin.importLineTools(hiddenDrawingsRef.current);
        hiddenDrawingsRef.current = null;
        setDrawingsHidden(false);
      }
      drawings.forEach((drawing) => plugin.addLineTool(drawing.toolType, drawing.points, drawing.options));
      recordDrawingState(plugin.exportLineTools());
    } catch {}
  };

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.defaultPrevented || target?.closest('input, textarea, select, [contenteditable=true], [role="menu"]') || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      const alt = event.altKey && !mod && !event.shiftKey;
      const claim = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (alt && key === "g") { claim(); openGoToDate(); return; }
      if ((alt && key === "enter") || (!mod && !event.altKey && event.shiftKey && key === "f")) { claim(); void toggleFullscreen(); return; }
      if (mod && event.altKey && !event.shiftKey && key === "q") { claim(); chartRef.current?.timeScale().resetTimeScale(); followLatestRef.current = true; return; }
      if (mod && event.altKey && !event.shiftKey && key === "h") { claim(); toggleDrawingsVisibility(); return; }
      if (mod && event.altKey && !event.shiftKey && key === "s") { claim(); downloadSnapshot(); return; }
      if (mod && !event.altKey && !event.shiftKey && key === "c" && selectedDrawing) {
        claim();
        const serialized = JSON.stringify([selectedDrawing]);
        drawingClipboardRef.current = serialized;
        void navigator.clipboard?.writeText(serialized).catch(() => undefined);
        return;
      }
      if (mod && !event.altKey && !event.shiftKey && key === "v") {
        if (document.querySelector('[role="menu"]')) return;
        claim(); void pasteMainPrice(); return;
      }
      if (mod && event.shiftKey && !event.altKey && key === "s") {
        claim();
        const canvas = captureChartCanvas();
        canvas?.toBlob((blob) => {
          if (blob && navigator.clipboard?.write) void navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(() => setDataError("Không thể sao chép ảnh vào bộ nhớ tạm"));
        });
        return;
      }
      if (!mod && !event.altKey && !event.shiftKey && event.code === "NumpadDivide") { claim(); setIndicatorMenuOpen(true); return; }
      if (alt && ["h", "j", "v", "c", "t", "f"].includes(key)) {
        claim();
        if (drawingsLocked) return;
        if (key === "t" || key === "f") { startDrawing(key === "t" ? "TrendLine" : "FibRetracement"); return; }
        const point = crosshairDrawingPointRef.current;
        const plugin = lineToolsRef.current;
        if (!point || !Number.isFinite(point.price) || !plugin) return;
        selectCursor();
        const type: LineToolType = key === "h" ? "HorizontalLine" : key === "j" ? "HorizontalRay" : key === "v" ? "VerticalLine" : "CrossLine";
        plugin.addLineTool(type, [point], drawingPreset(type));
        recordDrawingState(plugin.exportLineTools());
        return;
      }
      if (!mod && !event.altKey && !event.shiftKey && key === "escape") {
        selectCursor();
        setSelectedDrawing(null);
        setSelectedLegend(null);
        setAxisMenu(null);
        setChartMenu(null);
      }
    };
    window.addEventListener("keydown", onShortcut, true);
    return () => window.removeEventListener("keydown", onShortcut, true);
  });

  const copyMainPrice = async (price: number) => {
    drawingClipboardRef.current = null;
    try {
      await navigator.clipboard.writeText(price.toFixed(currentPriceFormat.precision));
    } catch {}
  };

  const onChartMenuAction = (action: ChartMenuAction) => {
    if (!chartMenu) return;
    if (action === "reset") resetChartView();
    else if (action === "copy" && chartMenu.price !== null) void copyMainPrice(chartMenu.price);
    else if (action === "paste") void pasteMainPrice();
    else if (action === "drawings") clearDrawings();
    else if (action === "indicators") clearIndicators();
    else if (action === "marks") setMarksHidden((hidden) => !hidden);
    else if (action === "settings") setChartSettingsOpen(true);
    else if (action === "lock") {
      const chart = chartRef.current;
      if (!chart) return;
      if (lockedCrosshairRef.current) {
        lockedCrosshairRef.current = null;
        setCrosshairLocked(false);
        chart.clearCrosshairPosition();
        setVisibleBar(currentBarRef.current);
      } else if (chartMenu.time !== null && chartMenu.price !== null) {
        const series = chartMenu.paneIndex === mainPaneIndexRef.current ? seriesRef.current
          : chart.panes()[chartMenu.paneIndex]?.getSeries().find((series) => series.options().visible && series.data().length > 0);
        if (!series) return;
        const time = chartMenu.time as Bar["time"];
        lockedCrosshairRef.current = { time, price: chartMenu.price, series: series as NonNullable<typeof lockedCrosshairRef.current>["series"] };
        setCrosshairLocked(true);
        chart.setCrosshairPosition(chartMenu.price, time, series);
        setVisibleBar(barsByTimeRef.current.get(time));
      }
    }
  };

  const sourceSharesPane = (group: MovableSeries[]) => group.length > 0 && group[0].getPane().getSeries()
    .some((item) => {
      const inactiveVolume = !activeStudies.includes("volume") && [volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current].some((volume) => volume === item);
      return item !== timelineSeriesRef.current && !inactiveVolume && !group.includes(item as MovableSeries);
    });

  const moveSeriesGroup = (group: MovableSeries[], direction: "above" | "below" | "new-above" | "new-below") => {
    const chart = chartRef.current;
    if (!chart || group.length === 0) return;
    const sourceIndex = group[0].getPane().paneIndex();
    const createNew = direction.startsWith("new-");
    const above = direction.endsWith("above");
    if (createNew && !sourceSharesPane(group)) return;
    const adjacent = chart.panes()[sourceIndex + (above ? -1 : 1)];
    if (!createNew && !adjacent) return;
    const targetPane = createNew ? chart.addPane(true) : adjacent;
    if (createNew) targetPane.moveTo(sourceIndex + (above ? 0 : 1));
    transferSeriesGroup(group, targetPane);
    if (createNew) targetPane.setPreserveEmptyPane(false);
    syncPaneLayout();
  };
  const moveMainSeriesToPane = (direction: "above" | "below" | "new-above" | "new-below") => {
    const series = seriesRef.current;
    if (series) moveSeriesGroup(timelineSeriesRef.current ? [series, timelineSeriesRef.current] : [series], direction);
  };

  const moveMainSeriesOrder = (direction: "front" | "back" | "forward" | "backward") => {
    const series = seriesRef.current;
    if (!series) return;
    const lastOrder = Math.max(0, series.getPane().getSeries().length - 1);
    const order = series.seriesOrder();
    const others = series.getPane().getSeries().filter((item) => item !== series && item !== timelineSeriesRef.current).map((item) => item.seriesOrder());
    const next = direction === "front" ? lastOrder : direction === "back" ? 0
      : direction === "forward" ? Math.min(...others.filter((value) => value > order)) : Math.max(...others.filter((value) => value < order));
    if (Number.isFinite(next)) series.setSeriesOrder(next);
    setPaneRevision((revision) => revision + 1);
  };

  const moveVolumeToPane = (direction: "above" | "below" | "new-above" | "new-below") => {
    const group = [volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current]
      .filter((item): item is NonNullable<typeof item> => item !== null);
    moveSeriesGroup(group, direction);
    const chart = chartRef.current;
    const volume = volumeSeriesRef.current;
    if (chart && volume) {
      const paneIndex = volume.getPane().paneIndex();
      const scaleId = volume.options().priceScaleId ?? "right";
      const scale = chart.priceScale(scaleId, paneIndex);
      scale.applyOptions({ visible: true, scaleMargins: { top: 0.08, bottom: 0.05 } });
      scale.setAutoScale(true);
    }
  };

  useEffect(() => {
    if (activeStudies.includes("volume")) return;
    const main = seriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!main || !volume || main.getPane() === volume.getPane()) return;
    const group = [volume, volumeMaSeriesRef.current, volumeSmaSeriesRef.current]
      .filter((item): item is NonNullable<typeof item> => item !== null);
    transferSeriesGroup(group, main.getPane());
    syncPaneLayout();
  }, [activeStudies, syncPaneLayout, transferSeriesGroup]);

  const moveVolumeSeriesOrder = (direction: "front" | "back") => {
    const series = [volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current].filter((item): item is NonNullable<typeof item> => item !== null);
    if (direction === "front") series.forEach((item) => item.setSeriesOrder(item.getPane().getSeries().length - 1));
    else [...series].reverse().forEach((item) => item.setSeriesOrder(0));
  };

  const sourceGroupForId = (id: string): MovableSeries[] => {
    if (id.startsWith("reference:")) {
      const series = referenceStudies.instances.current.get(id)?.series;
      return series ? [series] : [];
    }
    if (id.startsWith("compare:")) {
      const source = compareSeriesRef.current.get(id.slice(8));
      return source ? [source] : [];
    }
    if (id === "study:macd") {
      const source = macdSeriesRef.current;
      return source ? [source.histogram, source.macd, source.signal] : [];
    }
    if (id === "study:rsi") {
      const source = rsiSeriesRef.current;
      return source ? [source.rsi, source.upper, source.lower] : [];
    }
    const source = priceIndicatorSeriesRef.current.get(id.slice(6));
    return source ? [source] : [];
  };

  const moveSourceToPane = (id: string, direction: "above" | "below" | "new-above" | "new-below") => moveSeriesGroup(sourceGroupForId(id), direction);
  const moveSourceOrder = (id: string, direction: "front" | "back") => {
    const group = sourceGroupForId(id);
    (direction === "front" ? group : [...group].reverse()).forEach((item) => item.setSeriesOrder(direction === "front" ? item.getPane().getSeries().length - 1 : 0));
  };
  const toggleSourceVisibility = (id: string) => {
    const group = sourceGroupForId(id);
    const visible = group.some((item) => item.options().visible !== false);
    if (id.startsWith("compare:")) {
      if (visible) compareHiddenRef.current.add(id.slice(8));
      else compareHiddenRef.current.delete(id.slice(8));
    }
    const reference = referenceStudies.instances.current.get(id);
    if (reference) reference.visible = !visible;
    if (reference) referenceStudies.refresh();
    const allowed = !id.startsWith("compare:") || comparisonAllowed(normalizeComparisonSettings(comparisonSettingsRef.current[id.slice(8)]), resolution);
    group.forEach((item) => item.applyOptions({ visible: !visible && allowed }));
    if (visible) setSelectedLegend((current) => current === id ? null : current);
    setPaneRevision((value) => value + 1);
  };
  const removeSource = (id: string) => {
    if (id.startsWith("reference:")) { referenceStudies.remove(id); syncPaneLayout(); }
    else if (id.startsWith("compare:")) {
      if (comparisonSettingsSymbol === id.slice(8)) setComparisonSettingsSymbol(null);
      setCompareSymbols((current) => current.filter((symbol) => symbol !== id.slice(8)));
    }
    else {
      const name = id.slice(6);
      const study = name === "macd" || name === "rsi" ? name : name.startsWith("EMA") ? "ema" : name.startsWith("BOLL") ? "boll" : "ma";
      if (activeStudies.includes(study)) toggleStudy(study);
    }
    if (selectedLegend === id) setSelectedLegend(null);
  };
  const pinSourceToScale = (id: string, side: "left" | "right") => {
    sourceScaleOverridesRef.current.set(id, side);
    sourceGroupForId(id).forEach((item) => item.applyOptions({ priceScaleId: side }));
    if (id === "study:macd" || id === "study:rsi") setIndicatorScaleSideOverrides((current) => ({ ...current, [id.slice(6)]: side }));
    setPaneRevision((value) => value + 1);
  };
  const mainPaneShared = seriesRef.current ? sourceSharesPane([seriesRef.current]) : false;
  const volumeGroup = [volumeSeriesRef.current, volumeMaSeriesRef.current, volumeSmaSeriesRef.current].filter((item): item is NonNullable<typeof item> => item !== null);
  const volumePaneShared = sourceSharesPane(volumeGroup);
  const menuScale = axisMenu && chartRef.current?.panes()[axisMenu.paneIndex]
    ? chartRef.current.priceScale(axisMenu.side, axisMenu.paneIndex)
    : null;
  const menuScaleOptions = menuScale?.options();
  const hoveredPane = hoverAxis && chartRef.current?.panes()[hoverAxis.paneIndex];
  const hoveredScaleOptions = hoveredPane?.getSeries().some((series) =>
    (series.options().priceScaleId ?? "right") === hoverAxis?.side,
  ) ? chartRef.current?.priceScale(hoverAxis!.side, hoverAxis!.paneIndex).options() : null;
  const hoveredIsMainAxis = hoverAxis?.paneIndex === mainPaneIndex && hoverAxis.side === mainScaleSide;
  const selectedFooterPane = footerAxis && chartRef.current?.panes()[footerAxis.paneIndex];
  const footerAxisIsValid = !comparisonActive && selectedFooterPane?.getSeries().some((series) =>
    (series.options().priceScaleId ?? "right") === footerAxis?.side,
  );
  const footerTarget = footerAxisIsValid ? footerAxis! : { side: mainScaleSide, paneIndex: mainPaneIndex };
  const footerIsMainAxis = footerTarget.paneIndex === mainPaneIndex && footerTarget.side === mainScaleSide;
  const footerScaleOptions = chartRef.current?.panes()[footerTarget.paneIndex]
    ? chartRef.current.priceScale(footerTarget.side, footerTarget.paneIndex).options()
    : null;
  const footerScaleMode: ScaleMode = footerIsMainAxis ? effectiveScaleMode
    : footerScaleOptions?.mode === PriceScaleMode.Percentage ? "percent"
      : footerScaleOptions?.mode === PriceScaleMode.IndexedTo100 ? "indexed"
        : footerScaleOptions?.mode === PriceScaleMode.Logarithmic ? "log" : "normal";
  const footerAutoScale = footerIsMainAxis ? autoScale && !scaleLocked : footerScaleOptions?.autoScale ?? autoScale;

  const getSourceLegends = (quoteBar?: Bar) => {
  const sourceLegends: SourceLegend[] = [];
  const paneRows = new Map<number, number>([[mainPaneIndex, 1]]);
  const addSourceLegend = (id: string, label: string, color: string, value?: string) => {
    const group = sourceGroupForId(id);
    if (group.length === 0) return;
    const paneIndex = group[0].getPane().paneIndex();
    const row = paneRows.get(paneIndex) ?? 0;
    sourceLegends.push({ id, label, color, value, top: (legendBounds.sourceTops[id] ?? legendBounds.top) + row * 24, paneIndex, shared: sourceSharesPane(group), visible: group.some((item) => item.options().visible !== false), scaleSide: group[0].options().priceScaleId === "left" ? "left" : "right", loading: historyLoading });
    paneRows.set(paneIndex, row + 1);
  };
  compareSymbols.forEach((compareSymbol, index) => {
    const quote = comparisonQuotes.find((item) => item.symbol === compareSymbol);
    const settings = normalizeComparisonSettings(comparisonSettings[compareSymbol], COMPARE_COLORS[index % COMPARE_COLORS.length]);
    const info = compareInfoRef.current.get(compareSymbol);
    const points = compareBarsRef.current.get(compareSymbol) ?? [];
    const at = quoteBar ? points.findLastIndex(point => Number(point.time) <= Number(quoteBar.time)) : points.length - 1;
    const price = points[at]?.value;
    const previous = points[at - 1]?.value ?? price;
    const change = price !== undefined && previous !== undefined ? price - previous : 0;
    const percent = previous ? change / previous * 100 : 0;
    const precision = comparisonPriceFormat(settings, info).precision;
    addSourceLegend(`compare:${compareSymbol}`, `${compareSymbol}${info?.exchange || quote?.exchange ? `, ${info?.exchange ?? quote?.exchange}` : ""}`, settings.color, price === undefined ? "N/A" : `${price.toFixed(precision)} ${change >= 0 ? "+" : ""}${change.toFixed(precision)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`);
    const legend = sourceLegends.find(item => item.id === `compare:${compareSymbol}`);
    if (legend) {
      legend.hasSettings = true;
      const view = compareViewsRef.current.get(compareSymbol);
      if (view && (view.selected !== (selectedLegend === legend.id) || view.marksHidden !== marksHidden)) {
        view.selected = selectedLegend === legend.id;
        view.marksHidden = marksHidden;
        compareSeriesRef.current.get(compareSymbol)?.applyOptions({});
      }
      legend.loading = (comparisonStatus[compareSymbol] ?? "loading") === "loading";
      if (comparisonStatus[compareSymbol] === "error") {
        legend.value = "Không tải được dữ liệu";
        legend.color = "#f23645";
      }
    }
  });
  const volumeRowTop = (volumePaneIndex === mainPaneIndex ? legendBounds.top : legendBounds.volumeTop)
    + (paneRows.get(volumePaneIndex) ?? 0) * 24;
  if (activeStudies.includes("volume")) paneRows.set(volumePaneIndex, (paneRows.get(volumePaneIndex) ?? 0) + 1);
  priceIndicatorSeriesRef.current.forEach((series, id) => {
    const label = id.startsWith("MA") ? `Moving Average ${id.slice(2)}` : id.startsWith("EMA") ? `Moving Average Exponential ${id.slice(3)}` : "Bollinger Bands";
    addSourceLegend(`study:${id}`, label, series.options().color);
  });
  if (macdSeriesRef.current) addSourceLegend("study:macd", "MACD 12 26 9", "#2962ff");
  if (rsiSeriesRef.current) addSourceLegend("study:rsi", "RSI 14", "#7e57c2");
  referenceStudies.instances.current.forEach((study) => {
    const point = study.points.find((item) => Number(item.time) === Number(quoteBar?.time)) ?? [...study.points].reverse().find((item) => !item.isProjection);
    const plot = study.definition?.metainfo.plots.find((item) => item.type === "line");
    const color = (plot && point?.colors[plot.id]) || (plot && study.settings?.styles[plot.id]?.color) || "#2196f3";
    const values = study.definition?.metainfo.plots.filter((item) => item.type === "line" && study.settings?.styles[item.id]?.visible !== false && study.settings?.styles[item.id]?.display !== 0).map((item) => {
      const value = point?.values[item.id];
      return value === undefined ? "N/A" : study.definition?.metainfo.format?.type === "volume" ? formatVolume(value) : value.toFixed(study.settings?.precision ?? 2);
    }).join("  ");
    const value = study.error ? `Lỗi: ${study.error}` : study.loading ? "Đang tải…" : study.settings?.statusValues ? values : undefined;
    if (study.series) addSourceLegend(study.id, study.name === "Volume" ? "Khối lượng" : study.definition?.metainfo.shortDescription ?? study.name, color, value);
    else sourceLegends.push({ id: study.id, label: study.name, color: study.error ? "#f23645" : color, value, top: legendBounds.top + (paneRows.get(mainPaneIndex) ?? 1) * 24, paneIndex: mainPaneIndex, shared: false, visible: true, scaleSide: "right" });
    const legend = sourceLegends.at(-1)!;
    legend.loading = !study.error && (study.loading || historyLoading);
    legend.parameters = study.definition?.metainfo.inputs.filter((input) => !input.isHidden && input.type !== "bool").map((input) => study.settings?.inputs[input.id]).filter((value) => value !== "").join(" ");
    if (study.name === "Volume" && study.settings) {
      const { inputs, styles } = study.settings;
      legend.parameters = `${styles.vol_ma?.visible ? `${inputs.length} ` : ""}${inputs.smoothingLine} ${inputs.smoothingLength}`;
    }
    if (!study.error && !study.loading && study.settings?.statusValues) {
      legend.values = study.definition?.metainfo.plots.filter((item) => item.type === "line" && study.settings?.styles[item.id]?.visible !== false && study.settings?.styles[item.id]?.display !== 0).map((item) => {
        const value = point?.values[item.id];
        return {
          text: value === undefined ? "N/A" : study.definition?.metainfo.format?.type === "volume" ? formatVolume(value) : value.toFixed(study.settings?.precision ?? 2),
          color: point?.colors[item.id]?.replace(/#[\da-f]{8}/i, (color) => color.slice(0, 7)) ?? study.settings?.styles[item.id]?.color ?? color,
        };
      });
    }
    legend.hasSettings = Boolean(study.settings);
    if (study.error) legend.color = "#f23645";
      if (study.view && (study.view.selected !== (selectedLegend === study.id) || study.view.marksHidden !== marksHidden)) {
        study.view.selected = selectedLegend === study.id;
        study.view.marksHidden = marksHidden;
      study.series?.applyOptions({});
    }
  });
    return { sourceLegends, volumeRowTop };
  };
  const { sourceLegends } = getSourceLegends(quoteStore.getSnapshot() ?? currentBarRef.current);
  useEffect(() => {
    if (active) return;
    setIndicatorMenuOpen(false);
    setTimeframeMenuOpen(false);
    setIsSymbolModalOpen(false);
    setChartMenu(null);
    setIsCompareModalOpen(false);
    setIntervalQuery(null);
    closeGoToDate();
    setChartSettingsOpen(false);
    setTextDialogOpen(false);
    referenceStudies.setSettingsId(null);
    setComparisonSettingsSymbol(null);
    setAxisMenu(null);
    setHoverAxis(null);
    panGestureRef.current = null;
    zoomStartRef.current = null;
    setZoomSelection(null);
    if (document.fullscreenElement?.id === "app") void document.exitFullscreen();
  }, [active, closeGoToDate, referenceStudies.setSettingsId]);

  const referenceSettings = referenceStudies.settingsId ? referenceStudies.instances.current.get(referenceStudies.settingsId) : undefined;
  const scaleButtonTargets: ScaleButtonTarget[] = (["left", "right"] as const).flatMap((side) => {
    const panes = chartRef.current?.panes() ?? [];
    const candidates = panes.filter((pane) => !panePresentation.hidden.includes(pane.paneIndex()) && pane.getSeries().some((series) => series.options().priceScaleId === side));
    const pane = candidates.find((item) => item.paneIndex() === mainPaneIndex) ?? candidates[0];
    if (!pane) return [];
    const paneIndex = pane.paneIndex();
    const titles: string[] = [];
    if (paneIndex === mainPaneIndex && side === mainScaleSide) titles.push(`${symbol}, ${symbolInfo?.exchange ?? ""}, ${["D", "W", "M"].includes(resolution) ? `1${resolution}` : resolution}`);
    sourceLegends.filter((source) => source.paneIndex === paneIndex && source.scaleSide === side).forEach((source) => {
      const comparison = source.id.startsWith("compare:") ? comparisonQuotes.find((quote) => quote.symbol === source.id.slice(8)) : undefined;
      titles.push(comparison ? `${comparison.symbol}, ${comparison.exchange}` : source.label);
    });
    if (activeStudies.includes("volume") && volumePaneIndex === paneIndex && volumeSeriesRef.current?.options().priceScaleId === side) titles.push("Khối lượng");
    return [{ side, paneIndex, titles: [...new Set(titles)] }];
  });
  const menuRange = menuScale?.getVisibleRange();
  const menuHeight = axisMenu ? chartRef.current?.panes()[axisMenu.paneIndex]?.getHeight() : undefined;
  const menuScaleRatio = menuRange && menuHeight && menuScaleOptions && chartRef.current
    ? chartRef.current.timeScale().options().barSpacing * (menuRange.to - menuRange.from) / Math.max(1, menuHeight * (1 - menuScaleOptions.scaleMargins.top - menuScaleOptions.scaleMargins.bottom))
    : undefined;
  return (
    <>
      {active && (<DelayedTooltip />)}
      {active && (<OutsideDragSelectionGuard />)}
      {referenceSettings?.definition && referenceSettings.settings && (active && (<ReferenceStudySettingsDialog key={referenceSettings.id} definition={referenceSettings.definition} settings={referenceSettings.settings} onApply={(settings) => referenceStudies.apply(referenceSettings.id, settings)} onClose={() => referenceStudies.setSettingsId(null)}/>)) }
      {active && comparisonSettingsSymbol && compareSymbols.includes(comparisonSettingsSymbol) && <ComparisonSettingsDialog
        key={comparisonSettingsSymbol}
        title={`${comparisonSettingsSymbol}${compareInfoRef.current.get(comparisonSettingsSymbol)?.exchange ? `, ${compareInfoRef.current.get(comparisonSettingsSymbol)!.exchange}` : ""}`}
        settings={normalizeComparisonSettings(comparisonSettings[comparisonSettingsSymbol], COMPARE_COLORS[compareSymbols.indexOf(comparisonSettingsSymbol) % COMPARE_COLORS.length])}
        onApply={settings => setComparisonSettings(previous => ({ ...previous, [comparisonSettingsSymbol]: settings }))}
        onClose={() => setComparisonSettingsSymbol(null)}
      />}
      {!replayMode && (active ? (<AppHeader connectionStatus={status} timezone={chartTimezone} exchangeTimezone={symbolInfo?.timezone} onTimezoneChange={handleTimezoneChange} />) : <div className="chart-header-placeholder" />)}
      {active ? (<ChartHeader
        sourceLocked={replayMode}
        layoutReady={layoutReady}
        captureLayout={() => { flushLayout(); return captureWorkspace(); }}
        onLoadLayout={onLoadLayout}
        chartStyle={chartStyle}
        favoriteChartStyles={chartStylePreferences.favorites}
        onChartStyleChange={(style) => setChartStylePreferences((current) => current.style === style ? current : { ...current, style })}
        onFavoriteChartStylesChange={(favorites) => setChartStylePreferences((current) => ({ ...current, favorites }))}
        symbol={symbol}
        compareSymbols={compareSymbols}
        recentCompareSymbols={recentCompareSymbols}
        resolution={resolution}
        timeframeMenuOpen={timeframeMenuOpen}
        indicatorMenuOpen={indicatorMenuOpen}
        indicatorSearch={indicatorSearch}
        activeStudies={activeStudies}
        maDescription={`${maLength} ${maType} ${smoothingLength}`}
        isFullscreen={isFullscreen}
        canUndo={canUndo}
        canRedo={canRedo}
        isSymbolModalOpen={isSymbolModalOpen}
        isCompareModalOpen={isCompareModalOpen}
        initialSearchQuery={symbolSearchInitialQuery}
        onSymbolModalToggle={(open) => {
          if (open && replayMode) return;
          setIsSymbolModalOpen(open);
          if (!open) setSymbolSearchInitialQuery("");
        }}
        onCompareModalToggle={setIsCompareModalOpen}
        onSymbolChange={(nextSymbol) => {
          if (replayMode) { setDataError("Đổi mã tại phần nguồn Backtest và nạp lại dữ liệu."); setIsSymbolModalOpen(false); return; }
          setSymbol(nextSymbol);
          setCompareSymbols((current) => current.filter((compareSymbol) => compareSymbol !== nextSymbol));
          setIsSymbolModalOpen(false);
          setSymbolSearchInitialQuery("");
        }}
        onCompareSymbolAdd={(nextSymbol) => {
          if (nextSymbol !== symbol) {
            if (!comparisonSettings[nextSymbol]) {
              const defaults = normalizeComparisonSettings(readSaved("chart.comparisonDefaults.v1"), COMPARE_COLORS[compareSymbols.length % COMPARE_COLORS.length]);
              setComparisonSettings(previous => ({ ...previous, [nextSymbol]: defaults }));
            }
            setCompareSymbols((current) => current.includes(nextSymbol)
              ? current
              : [...current, nextSymbol]);
            setRecentCompareSymbols((current) => [
              nextSymbol,
              ...current.filter((compareSymbol) => compareSymbol !== nextSymbol),
            ].slice(0, 20));
          }
        }}
        onCompareSymbolRemove={(compareSymbol) => {
          if (comparisonSettingsSymbol === compareSymbol) setComparisonSettingsSymbol(null);
          setCompareSymbols((current) => current.filter((item) => item !== compareSymbol));
        }}
        onResolutionChange={(nextResolution) => {
          if (replayMode && nextResolution !== "1") { setDataError("Backtest AI dùng M1. Nguồn replay không đổi khi chọn interval khác."); setTimeframeMenuOpen(false); return; }
          setRangeDays(undefined);
          setResolution(nextResolution);
          setTimeframeMenuOpen(false);
        }}
        onTimeframeMenuToggle={setTimeframeMenuOpen}
        onIndicatorMenuToggle={setIndicatorMenuOpen}
        onIndicatorSearchChange={setIndicatorSearch}
        onStudyToggle={toggleStudy}
        onAddReferenceStudy={(name) => {
          if (name === "Compare" || name === "Overlay") setIsCompareModalOpen(true);
          else void referenceStudies.add(name);
        }}
        onDownloadSnapshot={downloadSnapshot}
        onToggleFullscreen={toggleFullscreen}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenSettings={() => setChartSettingsOpen(true)}
      />) : <div className="chart-controls-placeholder" />}
      <div className="chart-shell">
        {active ? (<DrawingToolbar
          activeTool={activeDrawingTool}
          zoomActive={zoomMode}
          canUndoZoom={zoomHistoryCount > 0}
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
          onToggleZoom={toggleZoomMode}
          onUndoZoom={undoZoom}
          onClear={clearDrawings}
          onClearIndicators={clearIndicators}
          onClearAll={clearChartObjects}
        />) : <div className="chart-toolbar-placeholder" />}
        <div className="chart-stage" onMouseMoveCapture={onAxisHover} onMouseLeave={() => { setHoverAxis(null); if (containerRef.current) containerRef.current.dataset.axisCursor = ""; }}>
          <PaneControls chart={chartRef.current} revision={paneRevision + referenceStudies.revision} onLayoutChange={syncPaneLayout} onPresentationChange={updatePanePresentation} mainPane={seriesRef.current?.getPane() ?? null} allowDoubleClick={!selectedDrawing} onRemovePane={(pane) => {
            const ids = sourceLegends.filter((source) => source.paneIndex === pane.paneIndex()).map((source) => source.id);
            const containsVolume = volumeSeriesRef.current?.getPane() === pane;
            ids.forEach(removeSource);
            if (containsVolume) setActiveStudies((current) => current.filter((study) => study !== "volume"));
            syncPaneLayout();
          }}/>
          {active && (<LiveMarketData store={quoteStore}>{(visibleBar) => {
            const quoteBar = visibleBar ?? currentBarRef.current;
            const previousClose = quoteBar ? previousCloseByTimeRef.current.get(Number(quoteBar.time)) : undefined;
            const { sourceLegends, volumeRowTop } = getSourceLegends(quoteBar);
            return <MarketDataPanel
            contextMenuTarget={containerRef.current}
            panePresentation={panePresentation}
            symbol={symbol}
            exchange={symbolInfo?.exchange ?? ""}
            symbolInfo={symbolInfo}
            pricePrecision={currentPriceFormat.precision}
            resolution={resolution}
            quoteBar={chartStyleRendererRef.current?.displayBar(quoteBar) ?? quoteBar}
            rawQuoteBar={quoteBar}
            rawPreviousClose={previousClose}
            previousClose={chartStyle === 8 ? chartStyleRendererRef.current?.previousClose(quoteBar?.time) : previousClose}
            chartStyle={chartStyle}
            chartStyleSettings={activeStyleSettings}
            chartStyleColor={chartStyleRendererRef.current?.barColor(quoteBar)}
            sourceLegends={sourceLegends}
            volumeRowTop={volumeRowTop}
            onMoveSourceToPane={moveSourceToPane}
            onMoveSourceOrder={moveSourceOrder}
            onToggleSourceVisibility={toggleSourceVisibility}
            onRemoveSource={removeSource}
            onOpenSourceSettings={id => { if (id.startsWith("compare:")) setComparisonSettingsSymbol(id.slice(8)); else referenceStudies.setSettingsId(id); }}
            onPinSourceToScale={pinSourceToScale}
            seriesVisible={mainSeriesVisible}
            scaleSide={mainScaleSide}
            leftAxisWidth={legendBounds.left}
            rightAxisWidth={legendBounds.right}
            paneTop={legendBounds.top}
            loading={historyLoading}
            volumeEnabled={activeStudies.includes("volume")}
            mainPaneIndex={mainPaneIndex}
            mainPaneShared={mainPaneShared}
            volumePaneShared={volumePaneShared}
            volumePaneIndex={volumePaneIndex}
            paneCount={chartRef.current?.panes().length ?? 1}
            volumeHidden={volumeHidden}
            volumeScaleSide={volumeScaleSideOverride ?? (volumePaneIndex !== mainPaneIndex ? mainScaleSide : mainScaleSide === "right" ? "left" : "right")}
            currentVolumeMa={latestVolumeValue()}
            maLength={maLength}
            maType={maType}
            smoothingLength={smoothingLength}
            volumeSettings={{
              maLength,
              smoothingType: maType,
              smoothingLength,
              ...volumeVisualSettings,
              maVisible: volumeMaVisible,
              smoothedVisible: volumeSmoothedMaVisible,
            } satisfies VolumeSettings}
            selectedLegend={selectedLegend}
            onSelectLegend={setSelectedLegend}
            seriesValueVisible={axisLabels.seriesValue}
            priceLineVisible={axisLines.price}
            appearance={chartAppearance}
            onOpenChartSettings={() => setChartSettingsOpen(true)}
            onToggleSeriesVisibility={() => {
              if (mainSeriesVisible) setSelectedLegend((current) => current === "instrument" ? null : current);
              setMainSeriesVisible((visible) => !visible);
            }}
            onCopyPrice={(price) => void copyMainPrice(price)}
            onPastePrice={() => void pasteMainPrice()}
            onMoveToPane={moveMainSeriesToPane}
            canMoveToPane={mainPaneShared || (chartRef.current?.panes().length ?? 0) > 1}
            onMoveSeriesOrder={moveMainSeriesOrder}
            mainOrder={{
              front: seriesRef.current?.getPane().getSeries().some((item) => item !== timelineSeriesRef.current && item.seriesOrder() > seriesRef.current!.seriesOrder()) ?? false,
              back: seriesRef.current?.getPane().getSeries().some((item) => item !== timelineSeriesRef.current && item.seriesOrder() < seriesRef.current!.seriesOrder()) ?? false,
            }}
            onPinToScale={setScaleSideOverride}
            onToggleSeriesValue={() => setAxisLabels((current) => ({ ...current, seriesValue: !current.seriesValue }))}
            onTogglePriceLine={() => setAxisLines((current) => ({ ...current, price: !current.price }))}
            onRemoveVolume={() => {
              setActiveStudies((current) => current.filter((id) => id !== "volume"));
              setSelectedLegend((current) => current === "volume" ? null : current);
              setVolumeHidden(false);
            }}
            onToggleVolumeVisibility={() => {
              if (!volumeHidden) setSelectedLegend((current) => current === "volume" ? null : current);
              setVolumeHidden((hidden) => !hidden);
            }}
            onMoveVolumeToPane={moveVolumeToPane}
            onMoveVolumeSeriesOrder={moveVolumeSeriesOrder}
            onPinVolumeToScale={setVolumeScaleSideOverride}
            onMaLengthChange={setMaLength}
            onMaTypeChange={setMaType}
            onSmoothingLengthChange={setSmoothingLength}
            onVolumeSettingsApply={(settings) => {
              setMaLength(settings.maLength);
              setMaType(settings.smoothingType);
              setSmoothingLength(settings.smoothingLength);
              setVolumeMaVisible(settings.maVisible);
              setVolumeSmoothedMaVisible(settings.smoothedVisible);
              setVolumeVisualSettings({
                colorByPreviousClose: settings.colorByPreviousClose,
                histogramVisible: settings.histogramVisible,
                upColor: settings.upColor,
                downColor: settings.downColor,
                maColor: settings.maColor,
                smoothedColor: settings.smoothedColor,
                maPlotStyle: settings.maPlotStyle,
                smoothedPlotStyle: settings.smoothedPlotStyle,
                maPriceLineVisible: settings.maPriceLineVisible,
                smoothedPriceLineVisible: settings.smoothedPriceLineVisible,
                scaleLabelVisible: false,
                statusValueVisible: settings.statusValueVisible,
                visibleIntervals: settings.visibleIntervals,
              });
            }}
          />;
          }}</LiveMarketData>)}
          <main
            id={replayMode ? "backtest-chart" : "chart"}
            ref={containerRef}
            className={zoomMode ? "chart--tool-active chart--zoom" : activeDrawingTool || eraserMode ? "chart--tool-active" : "chart--pan"}
            onContextMenuCapture={onAxisContextMenu}
          />
          {active && chartMenu && <ChartContextMenu position={chartMenu} precision={currentPriceFormat.precision}
            locked={crosshairLocked} marksHidden={marksHidden}
            hasDrawings={(hiddenDrawingsRef.current ?? drawingHistoryRef.current.at(-1) ?? "[]") !== "[]"}
            onAction={onChartMenuAction} onClose={closeChartMenu} />}
          {zoomSelection && (
            <div className="chart-zoom-selection" style={zoomSelection} aria-hidden="true" />
          )}
          {hoverAxis && hoveredScaleOptions && !panePresentation.hidden.includes(hoverAxis.paneIndex) && !panePresentation.collapsed.includes(hoverAxis.paneIndex) && (
            <div
              className={`price-axis-hover price-axis-hover--${hoverAxis.side}`}
              style={{ left: hoverAxis.left + 1, top: hoverAxis.top, width: Math.max(0, hoverAxis.width - 2), backgroundColor: chartAppearance.backgroundColor }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label="Tự động (khớp Dữ liệu với Màn hình)"
                aria-pressed={hoveredIsMainAxis ? effectiveScaleMode === "percent" || effectiveScaleMode === "indexed" || (autoScale && !scaleLocked) : hoveredScaleOptions.autoScale}
                disabled={hoveredScaleOptions.mode === PriceScaleMode.Percentage || hoveredScaleOptions.mode === PriceScaleMode.IndexedTo100 || (hoveredIsMainAxis && scaleLocked)}
                data-tooltip="Tự động (khớp Dữ liệu với Màn hình)"
                data-tooltip-placement="top"
                onClick={() => toggleHoverAxisMode("auto")}
              >A</button>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Logarit"
                aria-pressed={hoveredIsMainAxis ? effectiveScaleMode === "log" : hoveredScaleOptions.mode === PriceScaleMode.Logarithmic}
                disabled={hoveredIsMainAxis && scaleLocked}
                data-tooltip="Logarit"
                data-tooltip-placement="top"
                onClick={() => toggleHoverAxisMode("log")}
              >L</button>
            </div>
          )}
          {active && (<PriceAxisScaleButton chart={chartRef.current} targets={scaleButtonTargets} active={axisMenu} onOpen={(position) => { setHoverAxis(null); setFooterAxis({ side: position.side, paneIndex: position.paneIndex }); setAxisMenu(position); }} onClose={closeAxisMenu}/>)}
          {active && (<ScrollToLatestButton chart={chartRef.current} series={seriesRef.current}
            latestTime={currentBarRef.current?.time} rightOffset={chartAppearance.rightMargin}
            paneRevision={paneRevision} onNavigate={(phase) => {
              followLatestRef.current = phase === "complete";
              if (phase === "start") {
                viewportInteractionRef.current += 1;
                dateNavigationControllerRef.current?.abort();
              }
            }} />)}
          {mainPanePlotVisible && countdown && countdownVisible && (
            <div className="price-axis-countdown" style={{ top: countdown.top, ...(mainScaleSide === "right" ? { right: 0 } : { left: 0 }) }}>
              {countdown.text}
            </div>
          )}
          {olderHistoryLoading && !historyLoading && !dataError && <div className="chart-history-loading"><LoadingIndicator label="Đang tải lịch sử biểu đồ" /></div>}
          {dataError && <div className="chart-data-error" role="alert">{dataError}</div>}
          {mainPanePlotVisible && selectedDrawing && chartRef.current && seriesRef.current && lineToolsRef.current && (selectedDrawing.toolType !== "PriceNote" || priceNoteVisible(selectedDrawing.options as PriceNoteOptions, resolution)) && (
            <DrawingAxisRangeHighlight
              drawing={selectedDrawing}
              chart={chartRef.current}
              series={seriesRef.current}
              lineTools={lineToolsRef.current}
              viewportVersion={drawingViewportVersion}
            />
          )}
          {mainPanePlotVisible && selectedDrawing && (
            (active && (<DrawingPropertiesToolbar
              drawing={selectedDrawing}
              anchor={drawingToolbarAnchor}
              onChange={updateSelectedDrawing}
              onOpenSettings={() => {
                if (selectedDrawing.toolType === "Text" || selectedDrawing.toolType === "Callout" || selectedDrawing.toolType === "PriceNote") openTextDialog(selectedDrawing);
              }}
              onToggleLock={toggleSelectedDrawingLock}
              onDelete={deleteSelectedDrawingById}
            />))
          )}
          {mainPanePlotVisible && selectedDrawing?.toolType === "PriceRange" && chartRef.current && seriesRef.current && (
            <PriceRangeStats
              drawing={selectedDrawing}
              chart={chartRef.current}
              series={seriesRef.current}
              chartTop={containerRef.current?.offsetTop ?? 40}
              bars={[...barsByTimeRef.current.values()]
                .filter((bar) => isTradingSessionTime(bar.time, resolution, symbolInfo?.session, symbolInfo?.timezone))
                .sort((a, b) => Number(a.time) - Number(b.time))}
              viewportVersion={drawingViewportVersion}
            />
          )}
          <ChartFooter
            rangeLocked={replayMode}
            rangeDays={rangeDays}
            scaleMode={footerScaleMode}
            autoScale={footerAutoScale}
            onRangeChange={applyRangePreset}
            onGoToDate={openGoToDate}
            onScaleModeChange={(mode) => {
              if (footerIsMainAxis) setMainScaleMode(mode);
              else {
                const priceScaleMode = mode === "percent" ? PriceScaleMode.Percentage
                  : mode === "indexed" ? PriceScaleMode.IndexedTo100
                    : mode === "log" ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal;
                const scale = chartRef.current?.priceScale(footerTarget.side, footerTarget.paneIndex);
                if (scale && chartRef.current) applyPriceScaleMode(chartRef.current, scale, priceScaleMode);
                setFooterAxis({ ...footerTarget });
              }
            }}
            onAutoScaleToggle={() => {
              if (footerIsMainAxis) toggleMainAutoScale();
              else {
                const scale = chartRef.current?.priceScale(footerTarget.side, footerTarget.paneIndex);
                if (scale) scale.setAutoScale(!scale.options().autoScale);
                setFooterAxis({ ...footerTarget });
              }
            }}
          />
        </div>
      </div>
      {axisMenu && menuScaleOptions && (
        (active && (<PriceAxisContextMenu
          position={axisMenu}
          mode={menuScaleOptions.mode}
          autoScale={menuScaleOptions.autoScale}
          inverted={menuScaleOptions.invertScale}
          locked={axisMenu.paneIndex === mainPaneIndex && axisMenu.side === mainScaleSide && scaleLocked}
          seriesOnly={seriesOnlyScale}
          labels={{ ...axisLabels, align: menuScaleOptions.alignLabels }}
          lines={axisLines}
          countdown={countdownVisible}
          isMainAxis={axisMenu.paneIndex === mainPaneIndex && axisMenu.side === mainScaleSide}
          scaleRatio={menuScaleRatio}
          onAction={runAxisMenuAction}
          onClose={closeAxisMenu}
        />))
      )}
      {intervalQuery !== null && (active && (<ChangeIntervalDialog
        initial={intervalQuery}
        supported={symbolInfo?.supportedResolutions.length ? symbolInfo.supportedResolutions : ["1", "5", "15", "30", "60", "D", "W", "M"]}
        onClose={() => setIntervalQuery(null)}
        onChange={(value) => { setRangeDays(undefined); setResolution(value); }}
      />))}
      {goToDateRange && (active && (<GoToDateDialog
        timezone={effectiveChartTimezone}
        daily={["D", "W", "M"].includes(resolution)}
        initialRange={goToDateRange}
        onClose={closeGoToDate}
        onNavigate={(from, to) => navigateHistoryRef.current(from, to)}
      />))}
      {active && (<ChartSettingsDialog
        open={chartSettingsOpen}
        chartStyle={chartStyle}
        styleSettings={activeStyleSettings}
        onStyleSettingsChange={(settings) => setChartStylePreferences((current) => ({ ...current, settings: { ...current.settings, [current.style]: settings } }))}
        appearance={chartAppearance}
        scaleMode={effectiveScaleMode}
        autoScale={autoScale && !scaleLocked}
        inverted={mainScaleInverted}
        timezone={chartTimezone}
        axisLabels={axisLabels}
        countdownVisible={countdownVisible}
        onAppearanceChange={(value) => {
          setChartAppearance(value);
          setAxisLines((current) => ({ ...current, price: value.lastPriceVisible, highLow: value.highLowVisible }));
          setAxisLabels((current) => ({ ...current, highLow: value.highLowVisible }));
        }}
        onScaleModeChange={setMainScaleMode}
        onAutoScaleChange={(value) => { setScaleLocked(false); setAutoScale(value); }}
        onInvertChange={setMainScaleInverted}
        onTimezoneChange={handleTimezoneChange}
        onAxisLabelChange={(key, value) => setAxisLabels((current) => ({ ...current, [key]: value }))}
        onCountdownChange={setCountdownVisible}
        onClose={() => setChartSettingsOpen(false)}
      />)}
      {editingTextDrawing?.toolType === "PriceNote" && textDialogOpen && chartRef.current && seriesRef.current && (
        (active && (<PriceNoteDialog
          drawing={editingTextDrawing as LineToolExport<"PriceNote">}
          chart={chartRef.current}
          series={seriesRef.current}
          onPreview={(drawing) => {
            lineToolsRef.current?.createOrUpdateLineTool(drawing.toolType, drawing.points, drawing.options, drawing.id);
            setSelectedDrawing(drawing);
          }}
          onCancel={() => {
            lineToolsRef.current?.createOrUpdateLineTool(editingTextDrawing.toolType, editingTextDrawing.points, editingTextDrawing.options, editingTextDrawing.id);
            setSelectedDrawing(editingTextDrawing);
            setTextDialogOpen(false);
            setEditingTextDrawing(null);
          }}
          onConfirm={(drawing) => {
            updateSelectedDrawing(drawing);
            setTextDialogOpen(false);
            setEditingTextDrawing(null);
          }}
        />))
      )}
      {editingTextDrawing && (editingTextDrawing.toolType === "Text" || editingTextDrawing.toolType === "Callout") && textDialogOpen && (
        (active && (<TextToolDialog
          title={editingTextDrawing.toolType === "Callout" ? "Chú thích" : "Văn bản"}
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
        />))
      )}
    </>
  );
}
