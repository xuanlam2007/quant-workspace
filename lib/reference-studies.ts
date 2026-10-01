import { fetchHistory, type Bar, type SymbolInfo } from "./dchart-api";

export type StudyValue = string | number | boolean;
export interface ReferenceInput {
  id: string;
  name: string;
  type: string;
  defval?: StudyValue;
  min?: number;
  max?: number;
  options?: StudyValue[];
  isHidden?: boolean;
}
export interface ReferencePlotStyle {
  color?: string;
  visible?: boolean;
  display?: number;
  linewidth?: number;
  linestyle?: number;
  width?: number;
  style?: number;
  showPrice?: boolean;
  plottype?: number | string;
  transparency?: number;
  trackPrice?: boolean;
  location?: string;
}
export interface ReferencePlot {
  id: string;
  type: string;
  target?: string;
  palette?: string;
}
export interface ReferenceMeta {
  id: string;
  description: string;
  shortDescription: string;
  is_price_study: boolean;
  is_hidden_study?: boolean;
  inputs: ReferenceInput[];
  plots: ReferencePlot[];
  styles: Record<string, { title?: string; histogramBase?: number; joinPoints?: boolean; isHidden?: boolean }>;
  bands?: { id?: string; name?: string; value?: number }[];
  filledAreas?: { id: string; objAId: string; objBId: string; type: string }[];
  palettes?: Record<string, { valToIndex?: Record<string, number>; colors?: Record<string, { name?: string }> }>;
  defaults: {
    inputs?: Record<string, StudyValue>;
    styles?: Record<string, ReferencePlotStyle>;
    bands?: (ReferencePlotStyle & { value: number })[];
    filledAreasStyle?: Record<string, ReferencePlotStyle>;
    palettes?: Record<string, { colors: Record<string, ReferencePlotStyle> }>;
    graphics?: Record<string, Record<string, ReferencePlotStyle>>;
  };
  format?: { type: string; precision?: number };
}
export interface ReferenceDefinition {
  name: string;
  metainfo: ReferenceMeta;
  constructor: new () => object;
}
export interface ReferenceSettings {
  inputs: Record<string, StudyValue>;
  styles: Record<string, ReferencePlotStyle>;
  palettes: Record<string, { colors: Record<string, ReferencePlotStyle> }>;
  bands: (ReferencePlotStyle & { value: number })[];
  fills: Record<string, ReferencePlotStyle>;
  precision: number | null;
  scaleLabels: boolean;
  statusValues: boolean;
  intervals: { enabled: boolean; from: number; to: number }[];
}
export interface ReferencePoint {
  time: Bar["time"];
  isProjection?: boolean;
  values: Record<string, number>;
  colors: Record<string, string>;
  high: number;
  low: number;
}
export interface ReferenceGraphics {
  graphicsCmds?: {
    create?: Record<string, { styleId: string; data: Record<string, number | boolean | string>[] }[]>;
    erase?: { action: string }[];
  };
}
export interface ReferenceResult {
  points: ReferencePoint[];
  graphics: ReferenceGraphics[];
}

export const loadReferenceStudies = () => import("./vndirect-study-runtime.js");

export function referenceDefaults(definition: ReferenceDefinition): ReferenceSettings {
  const defaults = definition.metainfo.defaults;
  return {
    inputs: Object.fromEntries(definition.metainfo.inputs.map((input) => [input.id, defaults.inputs?.[input.id] ?? input.defval ?? ""])),
    styles: structuredClone(defaults.styles ?? {}),
    palettes: structuredClone(defaults.palettes ?? {}),
    bands: structuredClone(defaults.bands ?? []),
    fills: structuredClone(defaults.filledAreasStyle ?? {}),
    precision: definition.metainfo.format?.precision ?? null,
    scaleLabels: true,
    statusValues: true,
    intervals: [59, 24, 366, 52, 12].map((to) => ({ enabled: true, from: 1, to })),
  };
}

export function referenceColor(color = "#2196f3", transparency = 0) {
  const alpha = Math.max(0, Math.min(1, 1 - transparency / 100));
  if (/^#[\da-f]{6}$/i.test(color)) return color + (alpha === 1 ? "" : Math.round(alpha * 255).toString(16).padStart(2, "0"));
  const rgb = color.match(/^rgb\(([^)]+)\)$/);
  return rgb ? `rgba(${rgb[1]}, ${alpha})` : color;
}

const normalizePeriod = (period: string) => period.replace(/^1([DWM])$/, "$1");

export async function calculateReferenceStudy(definition: ReferenceDefinition, settings: ReferenceSettings, bars: Bar[], symbol: string, resolution: string, info?: SymbolInfo, signal?: AbortSignal): Promise<ReferenceResult> {
  if (!bars.length) return { points: [], graphics: [] };
  const { studyRuntime, projectStudyTimes } = await loadReferenceStudies();
  const datasets = new Map<string, Bar[]>([[`${symbol}:${normalizePeriod(resolution)}`, bars]]);
  let rows = new Map<number, unknown[]>();
  let graphics: ReferenceGraphics[] = [];
  const symbolInfo = (name: string) => ({ ...info, name, ticker: name, timezone: info?.timezone ?? "Asia/Bangkok", session: info?.session ?? "24x7", minmov: info?.minMove ?? 1, pricescale: info?.priceScale ?? 100, supported_resolutions: ["1", "5", "15", "30", "60", "D", "1D", "W", "1W", "M", "1M"] });
  for (let pass = 0; pass < 4; pass++) {
    signal?.throwIfAborted();
    rows = new Map();
    graphics = [];
    const missing = new Map<string, { symbol: string; resolution: string; from: number }>();
    let failure: string | undefined;
    studyRuntime.setupFeed({
      subscribe: (ticker, _currency, _unit, period, onData, _error, _info, _session, _range) => {
        const normalized = normalizePeriod(period), key = `${ticker}:${normalized}`;
        const source = datasets.get(key);
        if (!source) {
          const range = _range(symbolInfo(ticker));
          const anchor = Number.isFinite(range.to) ? range.to / 1000 : Number(bars[0].time);
          const count = Math.max(1, Math.ceil(range.countBack || 1));
          const historyStart = projectStudyTimes(symbolInfo(ticker), normalized, anchor, -count).at(-1) ?? anchor;
          missing.set(key, { symbol: ticker, resolution: normalized, from: Math.min(Number(bars[0].time), historyStart) });
        }
        const data = new studyRuntime.BarSet(symbolInfo(ticker), (source ?? []).map((bar) => ({ ...bar, time: Number(bar.time) * 1000, updatetime: Number(bar.time) * 1000 })));
        onData(data);
        return key;
      },
      unsubscribe: () => {},
    });
    const engine = new studyRuntime.StudyEngine({
      tickerid: symbol, period: resolution, body: new definition.constructor(),
      symbolInfo: symbolInfo(symbol), dataRange: { countBack: bars.length, from: Number(bars[0].time) * 1000, to: Number(bars.at(-1)!.time) * 1000 },
      input: (index) => settings.inputs[definition.metainfo.inputs[index]?.id],
      out: (source, row) => { const time = Number((source as { time?: number })?.time); if (Number.isFinite(time)) rows.set(time / 1000, [...row]); },
      nonseriesOut: (_source, data) => {
        if (!data.data) return;
        if (data.data.graphicsCmds?.erase?.some((command) => command.action === "all")) graphics = [];
        graphics.push(data.data);
      },
      onErrorCallback: (message) => { failure = message; },
      recalc: () => {}, setNoMoreData: () => {},
    });
    engine.stop();
    if (missing.size === 0) {
      if (failure) throw new Error(failure);
      break;
    }
    if (pass === 3) throw new Error("Không thể tải dữ liệu bổ sung cho chỉ báo");
    await Promise.all([...missing].map(async ([key, request]) => {
      const extra = await fetchHistory(request.symbol, request.resolution, request.from, Number(bars.at(-1)!.time) + 86400, signal);
      if (!extra.length) throw new Error(`Không có dữ liệu cho ${request.symbol}`);
      datasets.set(key, extra);
    }));
  }
  const points = bars.map((bar): ReferencePoint => ({ time: bar.time, values: {}, colors: {}, high: bar.high, low: bar.low }));
  const indices = new Map(points.map((point, index) => [Number(point.time), index]));
  const { plots, palettes } = definition.metainfo;
  const offsetColumns = plots.map((plot) => plots.findIndex((item) => item.type === "dataoffset" && item.target === plot.id));
  const plotValue = (row: unknown[], plotIndex: number) => {
    const raw = row[plotIndex];
    const object = raw && typeof raw === "object" ? raw as { value?: number; offset?: number } : undefined;
    const offsetColumn = offsetColumns[plotIndex];
    const offset = object?.offset ?? (offsetColumn >= 0 ? Number(row[offsetColumn]) : 0);
    return { value: object ? object.value : raw, offset: Number.isFinite(offset) ? Math.trunc(offset) : 0 };
  };
  let futureCount = 0;
  for (const [time, row] of rows) {
    const index = indices.get(time);
    if (index === undefined) continue;
    plots.forEach((plot, plotIndex) => {
      if (["colorer", "dataoffset", "bg_colorer", "bar_colorer"].includes(plot.type)) return;
      const { value, offset } = plotValue(row, plotIndex);
      if (typeof value === "number" && Number.isFinite(value)) futureCount = Math.max(futureCount, index + offset - bars.length + 1);
    });
  }
  if (futureCount > 0) {
    const times = projectStudyTimes(symbolInfo(symbol), resolution, Number(bars.at(-1)!.time), futureCount);
    for (const time of times) points.push({ time: time as Bar["time"], isProjection: true, values: {}, colors: {}, high: NaN, low: NaN });
  }
  let previousIndex: number | undefined;
  for (const [time, row] of rows) {
    const index = indices.get(time);
    if (index === undefined) continue;
    plots.forEach((plot, plotIndex) => {
      if (["colorer", "dataoffset", "bg_colorer", "bar_colorer"].includes(plot.type)) return;
      const { value, offset } = plotValue(row, plotIndex);
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const destination = points[index + offset];
      if (!destination) return;
      destination.values[plot.id] = value;
      const colorIndex = plots.findIndex((item) => item.type === "colorer" && item.target === plot.id);
      if (colorIndex >= 0) {
        const paletteId = plots[colorIndex].palette!;
        const key = String(row[colorIndex]);
        const paletteKey = palettes?.[paletteId]?.valToIndex?.[key] ?? key;
        const style = settings.palettes[paletteId]?.colors[String(paletteKey)];
        if (style?.color) destination.colors[plot.id] = referenceColor(style.color, settings.styles[plot.id]?.transparency ?? style.transparency);
      }
    });
    if (previousIndex !== undefined) {
      for (const fill of definition.metainfo.filledAreas ?? []) {
        const colorIndex = plots.findIndex((plot) => plot.type === "colorer" && plot.target === fill.id);
        if (colorIndex < 0) continue;
        const a = plots.findIndex((plot) => plot.id === fill.objAId);
        const b = plots.findIndex((plot) => plot.id === fill.objBId);
        const offset = Math.min(a >= 0 ? plotValue(row, a).offset : 0, b >= 0 ? plotValue(row, b).offset : 0);
        // Bundle gán màu của hàng kế tiếp cho đoạn bắt đầu tại hàng trước.
        const destination = points[previousIndex + offset];
        const paletteId = plots[colorIndex].palette;
        if (!destination || !paletteId || row[colorIndex] == null) continue;
        const key = String(row[colorIndex]);
        const paletteKey = palettes?.[paletteId]?.valToIndex?.[key] ?? key;
        const style = settings.palettes[paletteId]?.colors[String(paletteKey)];
        if (style?.color) destination.colors[fill.id] = referenceColor(style.color, settings.fills[fill.id]?.transparency ?? 90);
      }
    }
    previousIndex = index;
  }
  return { points, graphics };
}
