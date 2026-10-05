import { useEffect, useRef, type RefObject } from "react";
import type { IChartApi, IPriceScaleApi } from "lightweight-charts";
import { paneController, type Pane, type SavedPanePresentation } from "./pane-presentation";
import { readSaved, writeSaved } from "../config/saved-state";

interface SourceState { id: string; pane: number; side: string; visible: boolean; order: number }
interface ScaleState { mode: number; autoScale: boolean; invertScale: boolean; alignLabels: boolean; scaleMargins: { top: number; bottom: number }; range: { from: number; to: number } | null }
interface Layout { version: 1; context: string; time?: { barSpacing: number; rightOffset: number }; sources: SourceState[]; panes: { left: ScaleState; right: ScaleState }[]; presentation: SavedPanePresentation }
const KEY = "chart.workspaceLayout.v1";
interface PersistentSeries {
  getPane(): Pane;
  options(): { priceScaleId?: string; visible: boolean };
  applyOptions(options: { priceScaleId?: string; visible?: boolean }): void;
  seriesOrder(): number;
  setSeriesOrder(order: number): void;
}

function readLayout(): Layout | null {
  const saved = readSaved<Layout>(KEY);
  if (!saved || saved.version !== 1 || !Array.isArray(saved.sources) || !Array.isArray(saved.panes) || !saved.panes.length || saved.panes.length > 100) return null;
  if (!saved.presentation || !Array.isArray(saved.presentation.collapsed) || !Array.isArray(saved.presentation.factors)) return null;
  if (saved.sources.some((source) => !source || typeof source.id !== "string" || !Number.isInteger(source.pane) || source.pane < 0 || source.pane >= saved.panes.length || typeof source.side !== "string" || typeof source.visible !== "boolean" || !Number.isFinite(source.order))) return null;
  if (saved.panes.some((pane) => !pane || [pane.left, pane.right].some((scale) => !scale || ![0, 1, 2, 3].includes(scale.mode) || typeof scale.autoScale !== "boolean" || typeof scale.invertScale !== "boolean" || !scale.scaleMargins || !Number.isFinite(scale.scaleMargins.top) || !Number.isFinite(scale.scaleMargins.bottom) || scale.scaleMargins.top < 0 || scale.scaleMargins.bottom < 0 || scale.scaleMargins.top + scale.scaleMargins.bottom >= 1))) return null;
  return saved;
}

export function useSavedLayout<S extends PersistentSeries>({ chartRef, ready, revision, sources, transfer, changed, context, setRange }: {
  chartRef: RefObject<IChartApi | null>;
  ready: boolean;
  revision: number;
  sources: () => { id: string; series: S }[];
  transfer: (group: S[], pane: Pane) => void;
  changed: () => void;
  context: string;
  setRange: (scale: IPriceScaleApi, range: { from: number; to: number }) => void;
}) {
  const current = useRef({ ready, sources, transfer, changed, context, setRange });
  current.current = { ready, sources, transfer, changed, context, setRange };
  const restoredChart = useRef<IChartApi | null>(null);
  const saved = useRef<Layout | null | undefined>(undefined);
  const lastWritten = useRef("");
  const saveRef = useRef(() => {});

  useEffect(() => {
    if (!ready) return;
    const chart = chartRef.current;
    if (!chart) return;
    let frame = 0;
    const restore = () => {
      const controller = paneController(chart);
      if (!controller) { frame = requestAnimationFrame(restore); return; }
      if (restoredChart.current === chart) return;
      if (saved.current === undefined) saved.current = readLayout();
      const layout = saved.current;
      if (layout) {
        const available = current.current.sources();
        const assignments = new Map(layout.sources.map((source) => [source.id, source]));
        const oldPanes = chart.panes();
        oldPanes.forEach((pane) => pane.setPreserveEmptyPane(true));
        const targets = layout.panes.map(() => chart.addPane(true));
        // Giữ các cửa sổ cũ trong lúc chuyển để chỉ số không đổi giữa chừng.
        available.forEach(({ id, series }) => {
          const entry = assignments.get(id);
          const target = targets[entry?.pane ?? 0];
          current.current.transfer([series], target);
          if (entry) series.applyOptions({ priceScaleId: entry.side, visible: entry.visible });
        });
        [...oldPanes].reverse().forEach((pane) => {
          pane.setPreserveEmptyPane(false);
          if (!pane.getSeries().length) chart.removePane(pane.paneIndex());
        });
        targets.forEach((pane) => pane.setPreserveEmptyPane(false));
        available.sort((a, b) => (assignments.get(a.id)?.order ?? 0) - (assignments.get(b.id)?.order ?? 0)).forEach(({ id, series }) => {
          const entry = assignments.get(id);
          if (entry) series.setSeriesOrder(Math.max(0, Math.min(entry.order, series.getPane().getSeries().length - 1)));
        });
        current.current.changed();
        frame = requestAnimationFrame(() => {
          // Khôi phục trục sau các hiệu ứng React đồng bộ vị trí cửa sổ.
          targets.forEach((pane, index) => {
            for (const side of ["left", "right"] as const) {
              const scale = chart.priceScale(side, pane.paneIndex());
              const { range, ...options } = layout.panes[index][side];
              scale.applyOptions(options);
              if (layout.context === current.current.context && !options.autoScale && range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.from < range.to) current.current.setRange(scale, range);
            }
          });
          controller.restore(layout.presentation);
          if (layout.context === current.current.context && layout.time && Number.isFinite(layout.time.barSpacing) && layout.time.barSpacing > 0 && Number.isFinite(layout.time.rightOffset)) chart.timeScale().applyOptions(layout.time);
          restoredChart.current = chart;
        });
        return;
      }
      restoredChart.current = chart;
      current.current.changed();
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [chartRef, ready]);

  saveRef.current = () => {
    const chart = chartRef.current;
    if (!current.current.ready || !chart || restoredChart.current !== chart) return;
    const controller = paneController(chart);
    if (!controller) return;
    const sources = current.current.sources().map(({ id, series }) => ({ id, pane: series.getPane().paneIndex(), side: series.options().priceScaleId ?? "right", visible: series.options().visible, order: series.seriesOrder() }));
    const panes = chart.panes().map((pane) => {
      const state = (side: "left" | "right"): ScaleState => {
        const scale = chart.priceScale(side, pane.paneIndex());
        const { mode, autoScale, invertScale, alignLabels, scaleMargins } = scale.options();
        return { mode, autoScale, invertScale, alignLabels, scaleMargins, range: autoScale ? null : scale.getVisibleRange() };
      };
      return { left: state("left"), right: state("right") };
    });
    const { barSpacing, rightOffset } = chart.timeScale().options();
    const layout = { version: 1 as const, context: current.current.context, time: { barSpacing, rightOffset }, sources, panes, presentation: controller.snapshot() };
    const serialized = JSON.stringify(layout);
    if (serialized !== lastWritten.current) { writeSaved(KEY, layout); lastWritten.current = serialized; }
  };
  useEffect(() => {
    const timer = setTimeout(() => saveRef.current(), 250);
    return () => clearTimeout(timer);
  }, [revision, ready]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => saveRef.current(), 250); };
    const flush = () => saveRef.current();
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pointerup", schedule);
    window.addEventListener("wheel", schedule, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibility);
    return () => { clearTimeout(timer); window.removeEventListener("pointerup", schedule); window.removeEventListener("wheel", schedule); window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility); };
  }, []);
}
