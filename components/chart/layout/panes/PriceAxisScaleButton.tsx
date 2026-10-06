"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { PriceAxisMenuState } from "./PriceAxisContextMenu";
import { PRICE_AXIS_ICONS } from "./price-axis-icons";

export interface ScaleButtonTarget {
  side: "left" | "right";
  paneIndex: number;
  titles: string[];
}

interface Props {
  chart: IChartApi | null;
  targets: ScaleButtonTarget[];
  active: PriceAxisMenuState | null;
  onOpen: (position: PriceAxisMenuState) => void;
  onClose: () => void;
}

class AxisHoverHighlight implements ISeriesPrimitive<Time>, IPrimitivePaneView {
  private readonly views: IPrimitivePaneView[] = [this];

  constructor(private readonly side: "left" | "right") {}

  attached({ requestUpdate }: SeriesAttachedParameter<Time>) { requestUpdate(); }
  priceAxisPaneViews() { return this.views; }
  zOrder() { return "bottom" as const; }
  renderer() { return this; }
  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      const border = Math.max(1, Math.floor(horizontalPixelRatio));
      context.save();
      context.fillStyle = "rgba(42, 46, 57, 0.5)";
      context.fillRect(this.side === "right" ? border : 0, 0, Math.max(0, bitmapSize.width - border), bitmapSize.height);
      context.restore();
    });
  }
}

interface CornerBounds { left: number; top: number; width: number; height: number }

export function PriceAxisScaleButton({ chart, targets, active, onOpen, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Partial<Record<"left" | "right", CornerBounds>>>({});
  const [hoveredSide, setHoveredSide] = useState<"left" | "right" | null>(null);
  const hoveredTarget = targets.find((target) => target.side === hoveredSide);
  useEffect(() => {
    if (!chart || !hoveredTarget) return;
    const source = chart.panes()[hoveredTarget.paneIndex]?.getSeries().find((series) => series.options().visible && series.options().priceScaleId === hoveredTarget.side);
    if (!source) return;
    const highlight = new AxisHoverHighlight(hoveredTarget.side);
    source.attachPrimitive(highlight);
    return () => {
      // Nguồn có thể đã bị xóa khi đổi bố cục hoặc đóng pane.
      if (chart.panes().some((pane) => pane.getSeries().includes(source))) source.detachPrimitive(highlight);
    };
  }, [chart, hoveredTarget?.side, hoveredTarget?.paneIndex]);

  useLayoutEffect(() => {
    if (!chart || !root.current) return;
    const table = chart.chartElement().querySelector("table");
    if (!table) return;
    const measure = () => {
      const row = table.rows[table.rows.length - 1];
      const origin = root.current?.getBoundingClientRect();
      if (!row || !origin) return;
      const timeCanvas = row.cells[1]?.querySelector("canvas");
      const timeRect = timeCanvas?.getBoundingClientRect();
      const next: Partial<Record<"left" | "right", CornerBounds>> = {};
      if (timeRect && timeRect.height > 0) {
        (["left", "right"] as const).forEach((side) => {
          const canvas = row.cells[side === "left" ? 0 : 2]?.querySelector("canvas");
          const rect = canvas?.getBoundingClientRect();
          if (!rect || rect.width <= 0) return;
          next[side] = { left: rect.left - origin.left, top: timeRect.top - origin.top, width: rect.width, height: timeRect.height };
        });
      }
      setBounds((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    observer.observe(table);
    const observeCanvases = () => {
      table.querySelectorAll("canvas").forEach((canvas) => observer.observe(canvas));
      measure();
    };
    const mutations = new MutationObserver(observeCanvases);
    mutations.observe(table, { childList: true, subtree: true });
    observeCanvases();
    chart.timeScale().subscribeSizeChange(measure);
    return () => { observer.disconnect(); mutations.disconnect(); chart.timeScale().unsubscribeSizeChange(measure); };
  }, [chart]);

  return <div ref={root} className="price-axis-scale-buttons">
    {targets.map(({ side, paneIndex, titles }) => bounds[side] && <button key={side} type="button" tabIndex={-1} className={`price-axis-scale-button price-axis-scale-button--${side}`} style={bounds[side]} aria-label="Tùy chọn Thang giá" aria-haspopup="menu" aria-expanded={active?.origin === "scale-button" && active.side === side && active.paneIndex === paneIndex} data-tooltip={titles.join("\n")} data-tooltip-placement="top" data-tooltip-variant="axis" onPointerEnter={() => setHoveredSide(side)} onPointerLeave={() => setHoveredSide(null)} onPointerCancel={() => setHoveredSide(null)} onPointerDown={(event) => { event.stopPropagation(); if (event.pointerType === "touch") setHoveredSide(side); }} onPointerUp={(event) => { if (event.pointerType === "touch") setHoveredSide(null); }} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()} onClick={(event) => {
      if (active?.origin === "scale-button" && active.side === side && active.paneIndex === paneIndex) { onClose(); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      onOpen({ x: side === "right" ? rect.right : rect.left, y: rect.top, side, paneIndex, origin: "scale-button" });
    }}>{PRICE_AXIS_ICONS.settings}</button>)}
  </div>;
}
