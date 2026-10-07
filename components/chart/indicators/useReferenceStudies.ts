import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type Time, type WhitespaceData } from "lightweight-charts";
import type { Bar, SymbolInfo } from "@/lib/dchart-api";
import { calculateReferenceStudy, loadReferenceStudies, referenceDefaults, type ReferenceDefinition, type ReferencePoint, type ReferenceSettings } from "@/lib/reference-studies";
import { ReferenceStudyView } from "./ReferenceStudyView";
import { updateReferenceSeries } from "./reference-series-update";
import { chartStudyBars, type ChartStyle } from "../config/chart-styles";
import { mergeSaved, overlaySaved, readSaved, writeSaved } from "../config/saved-state";

interface SavedStudy { id: string; name: string; settings?: ReferenceSettings; visible: boolean }
const STORAGE_KEY = "chart.referenceStudies.v1";

export type ReferenceSeries = ISeriesApi<"Custom", Time, ReferencePoint | WhitespaceData<Time>>;
export interface ReferenceStudyInstance {
  id: string;
  name: string;
  definition?: ReferenceDefinition;
  settings?: ReferenceSettings;
  series?: ReferenceSeries;
  view?: ReferenceStudyView;
  points: ReferencePoint[];
  loading: boolean;
  error?: string;
  visible: boolean;
  priceLines?: IPriceLine[];
  priceLinePlots?: string[];
  request?: AbortController;
}

export function useReferenceStudies(chartRef: RefObject<IChartApi | null>, barsRef: RefObject<Map<number, Bar>>, symbol: string, resolution: string, symbolInfo?: SymbolInfo, chartStyle: ChartStyle = 1, labelsVisible?: (series: ReferenceSeries) => boolean, onData?: () => void) {
  const dataListener = useRef(onData);
  dataListener.current = onData;
  const labelsPolicy = useRef(labelsVisible);
  labelsPolicy.current = labelsVisible;
  const instances = useRef(new Map<string, ReferenceStudyInstance>());
  const [revision, setRevision] = useState(0);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const ready = useRef(false);
  const lastSaved = useRef("");
  const context = useRef({ symbol, resolution, symbolInfo, chartStyle });
  context.current = { symbol, resolution, symbolInfo, chartStyle };
  const refresh = useCallback(() => {
    if (ready.current) {
      const saved = [...instances.current.values()].map(({ id, name, settings, visible }) => ({ id, name, settings, visible }));
      const serialized = JSON.stringify(saved);
      if (serialized !== lastSaved.current) { writeSaved(STORAGE_KEY, saved); lastSaved.current = serialized; }
    }
    setRevision((value) => value + 1);
  }, []);
  const calculate = useCallback(async (instance: ReferenceStudyInstance, bars?: Bar[], realtime = false) => {
    if (!instance.definition || !instance.settings || !instance.series || !instance.view) return;
    instance.request?.abort();
    const request = new AbortController();
    instance.request = request;
    const current = context.current;
    const group = /M$/.test(current.resolution) ? 4 : /W$/.test(current.resolution) ? 3 : /D$/.test(current.resolution) ? 2 : Number(current.resolution) >= 60 ? 1 : 0;
    const multiple = group === 1 ? Number(current.resolution) / 60 : Number(current.resolution.replace(/[DWM]$/, "")) || 1;
    const interval = instance.settings.intervals[group];
    const wasLoading = instance.loading, previousError = instance.error;
    const visible = instance.visible && interval.enabled && multiple >= interval.from && multiple <= interval.to;
    if (instance.series.options().visible !== visible || !realtime) instance.series.applyOptions({ visible, lastValueVisible: false, baseLineVisible: false });
    try {
      const inputBars = bars ?? [...(barsRef.current?.values() ?? [])].sort((a, b) => Number(a.time) - Number(b.time));
      const result = await calculateReferenceStudy(instance.definition, instance.settings, chartStudyBars(inputBars, current.chartStyle), current.symbol, current.resolution, current.symbolInfo, request.signal);
      if (request.signal.aborted || !instances.current.has(instance.id)) return;
      const previousPoints = instance.points;
      const hadGraphics = instance.view.graphics.length > 0;
      instance.points = result.points;
      instance.view.settings = instance.settings;
      instance.view.graphics = result.graphics;
      if (realtime && !hadGraphics && !result.graphics.length && !previousPoints.some((point) => point.isProjection)) updateReferenceSeries(instance.series, previousPoints, result.points);
      else instance.series.setData(result.points);
      if (!instance.priceLinePlots) instance.priceLines?.forEach((line) => instance.series!.removePriceLine(line));
      const existingLines = new Map((instance.priceLinePlots ?? []).map((id, index) => [id, instance.priceLines![index]]));
      const nextLines: IPriceLine[] = [];
      const nextPlots: string[] = [];
      const latestPoints = [...result.points].reverse();
      for (const plot of instance.definition.metainfo.plots) {
        const style = instance.settings.styles[plot.id];
        const last = latestPoints.find((point) => Number.isFinite(point.values[plot.id]));
        const value = last?.values[plot.id];
        if (plot.type !== "line" || !style || style.visible === false || style.display === 0 || value === undefined || !Number.isFinite(value)) continue;
        if (!style.trackPrice && !instance.settings.scaleLabels) continue;
        const options = {
          price: value, color: last?.colors[plot.id] ?? style.color ?? "#2196f3",
          lineVisible: Boolean(style.trackPrice),
          axisLabelVisible: instance.settings.scaleLabels && (labelsPolicy.current?.(instance.series) ?? true),
          lineStyle: LineStyle.Dashed, lineWidth: 1 as const, title: "",
        };
        let line = existingLines.get(plot.id);
        if (line) {
          const old = line.options();
          if (Object.entries(options).some(([key, value]) => old[key as keyof typeof old] !== value)) line.applyOptions(options);
          existingLines.delete(plot.id);
        }
        else line = instance.series.createPriceLine(options);
        nextLines.push(line);
        nextPlots.push(plot.id);
      }
      existingLines.forEach((line) => instance.series!.removePriceLine(line));
      instance.priceLines = nextLines;
      instance.priceLinePlots = nextPlots;
      instance.error = undefined;
    } catch (error) {
      if (request.signal.aborted) return;
      instance.error = error instanceof Error ? error.message : String(error);
      instance.points = [];
      instance.series.setData([]);
      instance.priceLines?.forEach((line) => instance.series!.removePriceLine(line));
      instance.priceLines = [];
      instance.priceLinePlots = [];
    } finally {
      if (!request.signal.aborted) {
        instance.loading = false;
        if (!realtime || wasLoading || previousError !== instance.error) refresh();
        else dataListener.current?.();
      }
    }
  }, [barsRef, refresh]);

  const add = useCallback(async (name: string, saved?: SavedStudy) => {
    const instance: ReferenceStudyInstance = { id: saved?.id ?? `reference:${crypto.randomUUID()}`, name, settings: saved?.settings, points: [], loading: true, visible: saved?.visible ?? true };
    instances.current.set(instance.id, instance);
    refresh();
    try {
      const { bundledStudies } = await loadReferenceStudies();
      const chart = chartRef.current;
      if (!chart || instances.current.get(instance.id) !== instance) return;
      const definition = bundledStudies.find((study) => study.name === name || study.metainfo.description === name);
      if (!definition) throw new Error(`Không tìm thấy định nghĩa chỉ báo: ${name}`);
      instance.definition = definition;
      const defaults = referenceDefaults(definition);
      instance.settings = overlaySaved(defaults, saved?.settings);
      instance.settings.intervals = mergeSaved(defaults.intervals, saved?.settings?.intervals);
      instance.settings.precision = typeof instance.settings.precision === "number" && Number.isInteger(instance.settings.precision) && instance.settings.precision >= 0 && instance.settings.precision <= 12 ? instance.settings.precision : defaults.precision;
      instance.view = new ReferenceStudyView(definition, instance.settings);
      instance.series = chart.addCustomSeries(instance.view, {
        priceScaleId: "right", priceLineVisible: false, lastValueVisible: false,
        priceFormat: definition.metainfo.format?.type === "volume" ? { type: "volume" } : { type: "price", precision: instance.settings.precision ?? 2, minMove: 10 ** -(instance.settings.precision ?? 2) },
      }, chart.panes().length);
      instance.series.getPane().setStretchFactor(1);
      refresh();
      await calculate(instance);
    } catch (error) {
      instance.loading = false;
      instance.error = error instanceof Error ? error.message : String(error);
      refresh();
    }
  }, [calculate, chartRef, refresh]);

  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    const saved = readSaved<unknown>(STORAGE_KEY);
    const entries = Array.isArray(saved) ? saved.filter((item): item is SavedStudy => Boolean(item && typeof item.id === "string" && item.id.startsWith("reference:") && typeof item.name === "string" && typeof item.visible === "boolean")) : [];
    const unique = [...new Map(entries.map((item) => [item.id, item])).values()];
    void Promise.all(unique.map((item) => add(item.name, item))).then(() => {
      if (cancelled) return;
      ready.current = true; setRestored(true); refresh();
    });
    return () => { cancelled = true; ready.current = false; };
  }, [add, refresh]);

  const remove = useCallback((id: string) => {
    const instance = instances.current.get(id);
    if (!instance) return;
    instance.request?.abort();
    if (instance.series) chartRef.current?.removeSeries(instance.series);
    instances.current.delete(id);
    setSettingsId((current) => current === id ? null : current);
    refresh();
  }, [chartRef, refresh]);
  const clear = useCallback(() => { [...instances.current.keys()].forEach(remove); }, [remove]);
  const update = useCallback((bars?: Bar[], realtime = false) => { instances.current.forEach((instance) => { void calculate(instance, bars, realtime); }); }, [calculate]);
  const apply = useCallback((id: string, settings: ReferenceSettings) => {
    const instance = instances.current.get(id);
    if (!instance) return;
    instance.settings = settings;
    instance.series?.applyOptions({ priceFormat: instance.definition?.metainfo.format?.type === "volume" ? { type: "volume" } : { type: "price", precision: settings.precision ?? 2, minMove: 10 ** -(settings.precision ?? 2) } });
    void calculate(instance);
  }, [calculate]);
  useEffect(() => { update(); }, [symbol, resolution, symbolInfo, chartStyle, update]);
  useEffect(() => () => { instances.current.forEach((instance) => instance.request?.abort()); instances.current.clear(); }, []);
  return { instances, revision, restored, add, remove, clear, update, apply, settingsId, setSettingsId, refresh };
}
