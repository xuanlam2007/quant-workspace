"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { PANE_CONTROL_ICONS } from "./pane-control-icons";

type Pane = ReturnType<IChartApi["panes"]>[number];
interface Props {
  chart: IChartApi | null;
  revision: number;
  onLayoutChange: () => void;
  mainPane: Pane | null;
  onRemovePane: (pane: Pane) => void;
  allowDoubleClick: boolean;
}

export function PaneControls({ chart, revision, onLayoutChange, mainPane, onRemovePane, allowDoubleClick }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<{ pane: Pane; top: number; right: number }[]>([]);
  const [hovered, setHovered] = useState<Pane | null>(null);
  const collapsed = useRef(new Map<Pane, number>());
  const expanded = useRef<{ pane: Pane; heights: Map<Pane, number> } | null>(null);
  const restoreExpansion = () => {
    if (!chart || !expanded.current) return;
    expanded.current.heights.forEach((height, pane) => {
      if (chart.panes().includes(pane)) pane.setStretchFactor(height);
    });
    expanded.current = null;
  };
  const collapse = (pane: Pane) => {
    if (!chart || chart.panes().length < 2) return;
    restoreExpansion();
    const previousHeight = collapsed.current.get(pane);
    if (previousHeight !== undefined) {
      collapsed.current.delete(pane);
      pane.setHeight(previousHeight);
    } else {
      collapsed.current.set(pane, pane.getHeight());
      pane.setHeight(30);
    }
    onLayoutChange();
  };
  const expand = (pane: Pane) => {
    if (!chart || chart.panes().length < 2) return;
    const restoring = expanded.current?.pane === pane;
    restoreExpansion();
    if (!restoring) {
      const panes = chart.panes();
      expanded.current = { pane, heights: new Map(panes.map((item) => [item, item.getHeight()])) };
      pane.setHeight(panes.reduce((height, item) => height + item.getHeight(), 0) - 30 * (panes.length - 1));
    }
    onLayoutChange();
  };
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
    const doubleClick = (event: MouseEvent) => {
      if (!allowDoubleClick || event.defaultPrevented) return;
      if ((event.target as HTMLElement).closest("button, input, textarea, select, [role=dialog]")) return;
      const pane = chart.panes().find((item) => {
        const rect = item.getHTMLElement()?.getBoundingClientRect();
        return rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      if (!pane) return;
      if (event.ctrlKey || event.metaKey) collapse(pane);
      else expand(pane);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    chart.panes().forEach((pane) => { const node = pane.getHTMLElement(); if (node) observer.observe(node); });
    root.addEventListener("pointermove", pointer);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("dblclick", doubleClick);
    measure();
    return () => { observer.disconnect(); root.removeEventListener("pointermove", pointer); root.removeEventListener("pointerleave", leave); root.removeEventListener("dblclick", doubleClick); };
  }, [chart, revision, allowDoubleClick]);
  const move = (pane: Pane, offset: number) => {
    if (!chart || chart.panes().length < 2) return;
    const index = pane.paneIndex(), target = index + offset;
    if (target < 0 || target >= chart.panes().length) return;
    restoreExpansion();
    pane.moveTo(target);
    onLayoutChange();
  };
  return <div ref={rootRef} className="chart-pane-controls">
    {positions.length > 1 && positions.map(({ pane, top, right }, index) => <div key={index} className={`chart-pane-controls__row${hovered === pane ? " is-visible" : ""}`} style={{ top, right }} onPointerDown={(event) => event.stopPropagation()}>
      {index > 0 && <button type="button" tabIndex={-1} aria-label="Di chuyển cửa sổ lên" data-tooltip="Di chuyển cửa sổ lên" onClick={() => move(pane, -1)}><svg viewBox="0 0 15 15" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11.83 6.12l-.66.76L8 4.1V12H7V4.1L3.83 6.88l-.66-.76L7.5 2.34l4.33 3.78z"/></svg></button>}
      {index < positions.length - 1 && <button type="button" tabIndex={-1} aria-label="Di chuyển cửa sổ xuống" data-tooltip="Di chuyển cửa sổ xuống" onClick={() => move(pane, 1)}><svg viewBox="0 0 15 15" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11.83 8.88l-.66-.76L8 10.9V3H7v7.9L3.83 8.12l-.66.76 4.33 3.78 4.33-3.78z"/></svg></button>}
      {pane !== mainPane && <button type="button" tabIndex={-1} aria-label="Xóa khung" data-tooltip="Xóa khung" onClick={() => { restoreExpansion(); collapsed.current.delete(pane); onRemovePane(pane); }} dangerouslySetInnerHTML={{ __html: PANE_CONTROL_ICONS.close }}/>}
      <button type="button" tabIndex={-1} aria-label={collapsed.current.has(pane) ? "Khôi phục khung" : "Ngăn thu gọn"} data-tooltip={collapsed.current.has(pane) ? "Khôi phục khung" : "Ngăn thu gọn"} onClick={() => collapse(pane)} dangerouslySetInnerHTML={{ __html: collapsed.current.has(pane) ? PANE_CONTROL_ICONS.restore : PANE_CONTROL_ICONS.collapse }}/>
      <button type="button" tabIndex={-1} aria-label={expanded.current?.pane === pane ? "Khôi phục khung" : "Mở rộng khung"} data-tooltip={expanded.current?.pane === pane ? "Khôi phục khung" : "Mở rộng khung"} onClick={() => expand(pane)} dangerouslySetInnerHTML={{ __html: expanded.current?.pane === pane ? PANE_CONTROL_ICONS.collapse : PANE_CONTROL_ICONS.expand }}/>
    </div>)}
  </div>;
}
