import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { IChartApi, ISeriesApi, Time, WhitespaceData } from "lightweight-charts";
import type { Bar, SymbolInfo } from "@/lib/dchart-api";
import { calculateReferenceStudy, loadReferenceStudies, referenceDefaults, type ReferenceDefinition, type ReferencePoint, type ReferenceSettings } from "@/lib/reference-studies";
import { ReferenceStudyView } from "./ReferenceStudyView";

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
  request?: AbortController;
}

export function useReferenceStudies(chartRef: RefObject<IChartApi | null>, barsRef: RefObject<Map<number, Bar>>, symbol: string, resolution: string, symbolInfo?: SymbolInfo) {
  const instances = useRef(new Map<string, ReferenceStudyInstance>());
  const [revision, setRevision] = useState(0);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const context = useRef({ symbol, resolution, symbolInfo });
  context.current = { symbol, resolution, symbolInfo };
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const calculate = useCallback(async (instance: ReferenceStudyInstance, bars?: Bar[]) => {
    if (!instance.definition || !instance.settings || !instance.series || !instance.view) return;
    instance.request?.abort();
    const request = new AbortController();
    instance.request = request;
    const current = context.current;
    const group = /M$/.test(current.resolution) ? 4 : /W$/.test(current.resolution) ? 3 : /D$/.test(current.resolution) ? 2 : Number(current.resolution) >= 60 ? 1 : 0;
    const multiple = group === 1 ? Number(current.resolution) / 60 : Number(current.resolution.replace(/[DWM]$/, "")) || 1;
    const interval = instance.settings.intervals[group];
    instance.series.applyOptions({ visible: instance.visible && interval.enabled && multiple >= interval.from && multiple <= interval.to, lastValueVisible: instance.settings.scaleLabels });
    try {
      const result = await calculateReferenceStudy(instance.definition, instance.settings, bars ?? [...(barsRef.current?.values() ?? [])].sort((a, b) => Number(a.time) - Number(b.time)), current.symbol, current.resolution, current.symbolInfo, request.signal);
      if (request.signal.aborted || !instances.current.has(instance.id)) return;
      instance.points = result.points;
      instance.view.settings = instance.settings;
      instance.view.graphics = result.graphics;
      instance.series.setData(result.points);
      instance.error = undefined;
    } catch (error) {
      if (request.signal.aborted) return;
      instance.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (!request.signal.aborted) { instance.loading = false; refresh(); }
    }
  }, [barsRef, refresh]);

  const add = useCallback(async (name: string) => {
    const instance: ReferenceStudyInstance = { id: `reference:${crypto.randomUUID()}`, name, points: [], loading: true, visible: true };
    instances.current.set(instance.id, instance);
    refresh();
    try {
      const { bundledStudies } = await loadReferenceStudies();
      const chart = chartRef.current;
      if (!chart || !instances.current.has(instance.id)) return;
      const definition = bundledStudies.find((study) => study.name === name || study.metainfo.description === name);
      if (!definition) throw new Error(`Không tìm thấy định nghĩa chỉ báo: ${name}`);
      instance.definition = definition;
      instance.settings = referenceDefaults(definition);
      instance.view = new ReferenceStudyView(definition, instance.settings);
      instance.series = chart.addCustomSeries(instance.view, {
        priceScaleId: "right", priceLineVisible: false, lastValueVisible: instance.settings.scaleLabels,
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
  const update = useCallback((bars?: Bar[]) => { instances.current.forEach((instance) => { void calculate(instance, bars); }); }, [calculate]);
  const apply = useCallback((id: string, settings: ReferenceSettings) => {
    const instance = instances.current.get(id);
    if (!instance) return;
    instance.settings = settings;
    instance.series?.applyOptions({ priceFormat: instance.definition?.metainfo.format?.type === "volume" ? { type: "volume" } : { type: "price", precision: settings.precision ?? 2, minMove: 10 ** -(settings.precision ?? 2) } });
    void calculate(instance);
  }, [calculate]);
  useEffect(() => { update(); }, [symbol, resolution, symbolInfo, update]);
  useEffect(() => () => { instances.current.forEach((instance) => instance.request?.abort()); instances.current.clear(); }, []);
  return { instances, revision, add, remove, clear, update, apply, settingsId, setSettingsId, refresh };
}
