"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";
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

export function PriceAxisScaleButton({ chart, targets, active, onOpen, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ top: 0, height: 0, left: 0, right: 0 });
  useEffect(() => {
    const stage = root.current?.parentElement;
    if (!chart || !stage) return;
    const measure = () => {
      const row = chart.chartElement().querySelector("table")?.lastElementChild;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const next = { top: rect.top - stageRect.top, height: rect.height, left: row.children[0]?.getBoundingClientRect().width ?? 0, right: row.children[2]?.getBoundingClientRect().width ?? 0 };
      setBounds((current) => Object.keys(next).every((key) => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const row = chart.chartElement().querySelector("table")?.lastElementChild;
    if (row) observer.observe(row);
    chart.timeScale().subscribeSizeChange(measure);
    measure();
    return () => { observer.disconnect(); chart.timeScale().unsubscribeSizeChange(measure); };
  }, [chart]);

  return <div ref={root} className="price-axis-scale-buttons">
    {bounds.height > 0 && targets.map(({ side, paneIndex, titles }) => bounds[side] > 0 && <button key={side} type="button" tabIndex={-1} className={`price-axis-scale-button price-axis-scale-button--${side}`} style={{ top: bounds.top, height: bounds.height, width: bounds[side], [side]: 0 }} aria-label="Tùy chọn Thang giá" aria-haspopup="menu" aria-expanded={active?.origin === "scale-button" && active.side === side && active.paneIndex === paneIndex} data-tooltip={titles.join("\n")} data-tooltip-placement="top" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()} onClick={(event) => {
      if (active?.origin === "scale-button" && active.side === side && active.paneIndex === paneIndex) { onClose(); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      onOpen({ x: side === "right" ? rect.right : rect.left, y: rect.top, side, paneIndex, origin: "scale-button" });
    }}>{PRICE_AXIS_ICONS.settings}</button>)}
  </div>;
}
