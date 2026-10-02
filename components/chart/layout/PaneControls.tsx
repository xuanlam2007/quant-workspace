"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { PANE_CONTROL_ICONS } from "./pane-control-icons";
import { PanePresentationController, type Pane, type PanePresentation } from "./pane-presentation";

interface Props {
  chart: IChartApi | null;
  revision: number;
  onLayoutChange: () => void;
  onPresentationChange: (state: PanePresentation) => void;
  mainPane: Pane | null;
  onRemovePane: (pane: Pane) => void;
  allowDoubleClick: boolean;
}

type Action = { id: keyof typeof PANE_CONTROL_ICONS; label: string; run: () => void; hotkey?: string; mode?: string };

export function PaneControls({ chart, revision, onLayoutChange, onPresentationChange, mainPane, onRemovePane, allowDoubleClick }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const controller = useRef<PanePresentationController | null>(null);
  const [positions, setPositions] = useState<{ pane: Pane; top: number; right: number; width: number }[]>([]);
  const [hovered, setHovered] = useState<Pane | null>(null);
  const [menu, setMenu] = useState<Pane | null>(null);
  const [touch, setTouch] = useState(false);
  const callbacks = useRef({ onPresentationChange, onLayoutChange });
  useEffect(() => { callbacks.current = { onPresentationChange, onLayoutChange }; }, [onPresentationChange, onLayoutChange]);

  const measure = useCallback(() => {
    const root = rootRef.current?.parentElement;
    if (!chart || !root) return;
    const rootRect = root.getBoundingClientRect();
    const chartRect = chart.chartElement().getBoundingClientRect();
    setPositions(chart.panes().flatMap((pane) => {
      if (controller.current?.maximized && controller.current.maximized !== pane) return [];
      const rect = pane.getHTMLElement()?.getBoundingClientRect();
      if (!rect || !rect.height) return [];
      const scaleWidth = (side: "left" | "right") => {
        try { return chart.priceScale(side, pane.paneIndex()).width(); }
        catch { return 0; }
      };
      const right = scaleWidth("right");
      const left = scaleWidth("left");
      return [{ pane, top: rect.top - rootRect.top + 4, right: rootRect.right - chartRect.right + right + 4, width: rect.width - left - right }];
    }));
  }, [chart]);

  useEffect(() => {
    if (!chart) return;
    const presentation = new PanePresentationController(chart, (state) => {
      callbacks.current.onPresentationChange(state);
      measure();
    });
    controller.current = presentation;
    presentation.refresh();
    return () => { controller.current = null; presentation.dispose(); };
  }, [chart, measure]);

  useEffect(() => {
    controller.current?.refresh();
    if (menu && !chart?.panes().includes(menu)) setMenu(null);
  }, [chart, revision, menu]);

  useEffect(() => {
    const root = rootRef.current?.parentElement;
    if (!chart || !root) return;
    const paneAt = (x: number, y: number) => chart.panes().find((pane) => {
      if (controller.current?.maximized && controller.current.maximized !== pane) return false;
      const rect = pane.getHTMLElement()?.getBoundingClientRect();
      return rect && x >= rect.left && x <= rect.right && y >= rect.top && y < rect.bottom;
    }) ?? null;
    const pointer = (event: PointerEvent) => {
      setTouch(event.pointerType === "touch");
      setHovered(paneAt(event.clientX, event.clientY));
    };
    const leave = () => setHovered(null);
    const doubleClick = (event: MouseEvent) => {
      if (!allowDoubleClick || event.defaultPrevented || event.button !== 0) return;
      if ((event.target as Element).closest("button, input, textarea, select, [role=dialog], [role=menu], .market-data-panel")) return;
      const pane = paneAt(event.clientX, event.clientY);
      const plot = pane?.getHTMLElement()?.children[1]?.getBoundingClientRect();
      if (!pane || !plot || event.clientX < plot.left || event.clientX > plot.right) return;
      if ((event.ctrlKey || event.metaKey) && !controller.current?.maximized) controller.current?.toggleCollapsed(pane);
      else controller.current?.toggleMaximized(pane);
      callbacks.current.onLayoutChange();
    };
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    chart.panes().forEach((pane) => { const node = pane.getHTMLElement(); if (node) observer.observe(node); });
    root.addEventListener("pointermove", pointer);
    root.addEventListener("pointerdown", pointer);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("dblclick", doubleClick);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    measure();
    return () => {
      observer.disconnect();
      root.removeEventListener("pointermove", pointer);
      root.removeEventListener("pointerdown", pointer);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("dblclick", doubleClick);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [chart, revision, allowDoubleClick, measure]);

  const actionsFor = (pane: Pane): Action[] => {
    const state = controller.current;
    const panes = chart?.panes() ?? [];
    if (!state || panes.length < 2) return [];
    const run = (action: () => void) => () => { action(); setMenu(null); onLayoutChange(); };
    const maximize: Action = { id: "expand", mode: state.maximized ? "minimize" : "maximize", label: state.maximized ? "Khôi phục khung" : "Mở rộng khung", hotkey: "Nhấp đúp", run: run(() => state.toggleMaximized(pane)) };
    if (state.maximized) return [maximize];
    const result: Action[] = [];
    const index = pane.paneIndex();
    if (index > 0) result.push({ id: "up", label: "Di chuyển khung lên trên", run: run(() => pane.moveTo(index - 1)) });
    if (index < panes.length - 1) result.push({ id: "down", label: "Di chuyển khung xuống dưới", run: run(() => pane.moveTo(index + 1)) });
    if (pane !== mainPane) result.push({ id: "close", label: "Xóa khung", run: run(() => onRemovePane(pane)) });
    if (state.collapsed.has(pane) || state.canCollapse()) result.push({ id: state.collapsed.has(pane) ? "restore" : "collapse", label: state.collapsed.has(pane) ? "Khôi phục khung" : "Ngăn thu gọn", hotkey: `${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} + Nhấp đúp`, run: run(() => state.toggleCollapsed(pane)) });
    result.push(maximize);
    return result;
  };

  return <div ref={rootRef} className="chart-pane-controls">
    {(chart?.panes().length ?? 0) > 1 && positions.map(({ pane, top, right, width }) => {
      const actions = actionsFor(pane);
      const maximized = controller.current?.maximized === pane;
      const compact = !maximized && (width < 666.65 || touch);
      if (!maximized && width < 356) return null;
      const menuActions = [...actions].sort((a, b) => ["expand", "collapse", "restore", "up", "down", "close"].indexOf(a.id) - ["expand", "collapse", "restore", "up", "down", "close"].indexOf(b.id));
      const renderButton = (action: Action, inMenu = false) => <button key={action.id} type="button" tabIndex={-1} role={inMenu ? "menuitem" : undefined} className={`chart-pane-controls__button ${action.mode ?? action.id}`} aria-label={action.label} data-tooltip={action.label} data-tooltip-hotkey={action.hotkey} data-tooltip-placement="top" data-tooltip-disabled={inMenu || undefined} onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); action.run(); } }} onTouchEnd={(event) => { event.preventDefault(); action.run(); }} onClick={(event) => { if (event.detail === 0) action.run(); }}>
        <span className="chart-pane-controls__icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PANE_CONTROL_ICONS[action.id] }}/>
        {inMenu && <><span>{action.label}</span>{action.hotkey && <kbd>{action.hotkey}</kbd>}</>}
      </button>;
      return <div key={pane.paneIndex()} className={`chart-pane-controls__row${hovered === pane || menu === pane ? " is-visible" : ""}`} style={{ top, right }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
        {compact ? <button type="button" tabIndex={-1} className="chart-pane-controls__button" aria-label="Quản lý khung" data-tooltip="Quản lý khung" data-tooltip-placement="top" aria-haspopup="menu" aria-expanded={menu === pane} onClick={() => setMenu(menu === pane ? null : pane)} dangerouslySetInnerHTML={{ __html: PANE_CONTROL_ICONS.more }}/> : actions.map((action) => renderButton(action))}
        {compact && menu === pane && <div className="chart-pane-controls__menu" role="menu" aria-label="Quản lý khung">{menuActions.map((action) => renderButton(action, true))}</div>}
      </div>;
    })}
  </div>;
}
