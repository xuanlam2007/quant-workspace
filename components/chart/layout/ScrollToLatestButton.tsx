"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  latestTime?: Time;
  rightOffset: number;
  paneRevision: number;
  onNavigate: (phase: "start" | "complete" | "cancel") => void;
}

export function ScrollToLatestButton({ chart, series, latestTime, rightOffset, paneRevision, onNavigate }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const latestRef = useRef(latestTime);
  latestRef.current = latestTime;
  const actionRef = useRef<() => void>(() => undefined);
  const [layout, setLayout] = useState({ right: 0, bottom: 0, visible: false });

  useEffect(() => {
    if (!chart || !series || !root.current) return;
    const timeScale = chart.timeScale();
    let frame = 0;
    let running = false;
    const lastIndex = () => latestRef.current === undefined ? null : timeScale.timeToIndex(latestRef.current, true);
    const update = () => {
      const origin = root.current?.getBoundingClientRect();
      const chartRect = chart.chartElement().getBoundingClientRect();
      const visible = timeScale.getVisibleLogicalRange();
      const latest = lastIndex();
      if (!origin) return;
      const bottomPane = chart.panes().filter((pane) => (pane.getHTMLElement()?.getBoundingClientRect().height ?? 0) > 0).at(-1);
      const margin = bottomPane?.getSeries().includes(series) ? 32 : 5;
      const next = {
        right: origin.right - chartRect.right + chart.priceScale("right").width() + 16,
        bottom: origin.bottom - chartRect.bottom + timeScale.height() + margin,
        visible: latest !== null && visible !== null && visible.to < latest,
      };
      setLayout((current) => current.right === next.right && current.bottom === next.bottom && current.visible === next.visible ? current : next);
    };
    const cancel = () => {
      cancelAnimationFrame(frame);
      if (running) navigateRef.current("cancel");
      running = false;
    };
    const scroll = () => {
      const visible = timeScale.getVisibleLogicalRange();
      if (!visible || lastIndex() === null) return;
      cancel();
      running = true;
      navigateRef.current("start");
      const from = visible.to;
      const started = performance.now();
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1000;
      const step = (now: number) => {
        const latest = lastIndex();
        const current = timeScale.getVisibleLogicalRange();
        if (latest === null || !current) { cancel(); return; }
        const progress = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
        const eased = progress < 0.5 ? 16 * progress ** 5 : 1 - (-2 * progress + 2) ** 5 / 2;
        const target = latest + Math.max(0, rightOffset);
        const right = from + (target - from) * eased;
        timeScale.scrollToPosition(timeScale.scrollPosition() + right - current.to, false);
        if (progress < 1) frame = requestAnimationFrame(step);
        else {
          running = false;
          navigateRef.current("complete");
          update();
        }
      };
      frame = requestAnimationFrame(step);
    };
    actionRef.current = scroll;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowRight") {
        event.preventDefault();
        scroll();
      } else if (event.key === "Escape") cancel();
    };
    const element = chart.chartElement();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    resize.observe(root.current);
    timeScale.subscribeVisibleLogicalRangeChange(update);
    timeScale.subscribeSizeChange(update);
    const timer = window.setInterval(update, 1000);
    element.addEventListener("pointerdown", cancel, true);
    element.addEventListener("wheel", cancel, { passive: true, capture: true });
    document.addEventListener("keydown", onKeyDown);
    update();
    return () => {
      cancel();
      actionRef.current = () => undefined;
      resize.disconnect();
      window.clearInterval(timer);
      timeScale.unsubscribeVisibleLogicalRangeChange(update);
      timeScale.unsubscribeSizeChange(update);
      element.removeEventListener("pointerdown", cancel, true);
      element.removeEventListener("wheel", cancel, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [chart, series, rightOffset, paneRevision]);

  return <div ref={root} className="scroll-to-latest-layer">
    <button type="button" tabIndex={-1}
      className={`scroll-to-latest${layout.visible ? "" : " scroll-to-latest--hidden"}`}
      style={{ right: layout.right, bottom: layout.bottom }}
      aria-hidden={!layout.visible} disabled={!layout.visible}
      aria-label="Cuộn sang thanh gần đây nhất"
      data-tooltip="Cuộn sang thanh gần đây nhất" data-tooltip-placement="top"
      data-tooltip-variant="navigation" data-tooltip-hotkey="Alt + Shift + →"
      data-tooltip-disabled={!layout.visible}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={() => actionRef.current()}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M7.45 3.5 12.48 9l-5.03 5.49 1.1 1.01L14.52 9 8.55 2.49 7.45 3.5Z"/>
        <path fill="currentColor" d="m3.93 5.99 2.58 3-2.58 3.02 1.14.98 3.42-4-3.42-3.98L3.93 6Z"/>
      </svg>
    </button>
  </div>;
}
