"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";

type Pane = ReturnType<IChartApi["panes"]>[number];
interface Props {
  chart: IChartApi | null;
  revision: number;
  onLayoutChange: () => void;
}

export function PaneControls({ chart, revision, onLayoutChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<{ pane: Pane; top: number; right: number }[]>([]);
  const [hovered, setHovered] = useState<Pane | null>(null);
  useEffect(() => {
    const root = rootRef.current?.parentElement;
    if (!chart || !root) return;
    const element = chart.chartElement();
    const measure = () => {
      const rootRect = root.getBoundingClientRect();
      const chartRect = element.getBoundingClientRect();
      setPositions(chart.panes().flatMap((pane) => {
        const rect = pane.getHTMLElement()?.getBoundingClientRect();
        if (!rect) return [];
        let width = 0;
        try { width = chart.priceScale("right", pane.paneIndex()).width(); } catch {}
        return [{ pane, top: rect.top - rootRect.top + 6, right: rootRect.right - chartRect.right + width + 6 }];
      }));
    };
    const pointer = (event: PointerEvent) => {
      setHovered(chart.panes().find((pane) => {
        const rect = pane.getHTMLElement()?.getBoundingClientRect();
        return rect && event.clientY >= rect.top && event.clientY < rect.bottom;
      }) ?? null);
    };
    const leave = () => setHovered(null);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    chart.panes().forEach((pane) => { const node = pane.getHTMLElement(); if (node) observer.observe(node); });
    root.addEventListener("pointermove", pointer);
    root.addEventListener("pointerleave", leave);
    measure();
    return () => { observer.disconnect(); root.removeEventListener("pointermove", pointer); root.removeEventListener("pointerleave", leave); };
  }, [chart, revision]);
  const move = (pane: Pane, offset: number) => {
    if (!chart || chart.panes().length < 2) return;
    const index = pane.paneIndex(), target = index + offset;
    if (target < 0 || target >= chart.panes().length) return;
    pane.moveTo(target);
    onLayoutChange();
  };
  return <div ref={rootRef} className="chart-pane-controls">
    {positions.length > 1 && positions.map(({ pane, top, right }, index) => <div key={index} className={`chart-pane-controls__row${hovered === pane ? " is-visible" : ""}`} style={{ top, right }} onPointerDown={(event) => event.stopPropagation()}>
      {index > 0 && <button type="button" tabIndex={-1} aria-label="Di chuyển cửa sổ lên" data-tooltip="Di chuyển cửa sổ lên" onClick={() => move(pane, -1)}><svg viewBox="0 0 15 15" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11.83 6.12l-.66.76L8 4.1V12H7V4.1L3.83 6.88l-.66-.76L7.5 2.34l4.33 3.78z"/></svg></button>}
      {index < positions.length - 1 && <button type="button" tabIndex={-1} aria-label="Di chuyển cửa sổ xuống" data-tooltip="Di chuyển cửa sổ xuống" onClick={() => move(pane, 1)}><svg viewBox="0 0 15 15" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11.83 8.88l-.66-.76L8 10.9V3H7v7.9L3.83 8.12l-.66.76 4.33 3.78 4.33-3.78z"/></svg></button>}
    </div>)}
  </div>;
}