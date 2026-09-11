"use client";

import { useEffect, useRef, useState } from "react";
import { fetchHistory, type Bar } from "@/lib/dchart-api";
import { connectPriceFeed, type ConnStatus } from "@/lib/dchart-socket";
import { bucketStart, mergeTick } from "@/lib/bar-builder";

const SYMBOLS = ["VN30", "VNINDEX"];
const RESOLUTIONS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "D", label: "1D" },
];

// Tên công cụ vẽ gốc của KLineChart, tách khỏi plugin ở tab còn lại
const OVERLAY_GROUPS = [
  [
    { name: "segment", label: "Line", title: "KLineChart: segment" },
    { name: "rayLine", label: "Ray", title: "KLineChart: ray line" },
    { name: "straightLine", label: "∞", title: "KLineChart: straight line" },
    { name: "arrow", label: "↑", title: "KLineChart extension: arrow" },
  ],
  [
    { name: "horizontalStraightLine", label: "H", title: "KLineChart: horizontal straight line" },
    { name: "horizontalRayLine", label: "H→", title: "KLineChart: horizontal ray" },
    { name: "verticalStraightLine", label: "V", title: "KLineChart: vertical straight line" },
    { name: "priceLine", label: "$", title: "KLineChart: price line" },
  ],
  [
    { name: "rect", label: "□", title: "KLineChart extension: rectangle" },
    { name: "parallelStraightLine", label: "∥", title: "KLineChart: parallel line" },
    { name: "priceChannelLine", label: "Ch", title: "KLineChart: price channel" },
    { name: "fibonacciLine", label: "Fib", title: "KLineChart: Fibonacci line" },
  ],
  [
    { name: "brush", label: "✎", title: "KLineChart: brush" },
    { name: "simpleAnnotation", label: "Note", title: "KLineChart: annotation" },
    { name: "simpleTag", label: "Tag", title: "KLineChart: tag" },
  ],
];

function rangeForResolution(resolution: string) {
  const to = Math.floor(Date.now() / 1000);
  const daysBack = resolution === "D" ? 730 : resolution === "60" ? 30 : 5;
  return { from: to - daysBack * 86400, to };
}

function periodFor(resolution: string) {
  if (resolution === "D") return { span: 1, type: "day" as const };
  return { span: Number(resolution), type: "minute" as const };
}

function toKLines(bars: Bar[]) {
  return bars.map((bar) => ({
    timestamp: Number(bar.time) * 1000,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

export default function KLineChart({ onSelectLightweight }: { onSelectLightweight: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const barsRef = useRef<Bar[]>([]);
  const currentBarRef = useRef<Bar | undefined>(undefined);
  const feedRef = useRef<ReturnType<typeof connectPriceFeed> | null>(null);
  const overlayHistoryRef = useRef<string[]>(["[]"]);
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [resolution, setResolution] = useState("D");
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [lastPrice, setLastPrice] = useState("N/A");
  const [locked, setLocked] = useState(false);

  const snapshotOverlays = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const snapshot = JSON.stringify(chart.getOverlays().map(({ id, name, points, styles, extendData, lock }: any) => ({ id, name, points, styles, extendData, lock })));
    if (overlayHistoryRef.current.at(-1) !== snapshot) overlayHistoryRef.current.push(snapshot);
  };

  const restoreOverlays = (snapshot: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.removeOverlay();
    JSON.parse(snapshot).forEach((overlay: any) => chart.createOverlay(overlay));
  };

  useEffect(() => {
    let disposed = false;
    (async () => {
      const [{ init, dispose, registerOverlay }, { rect, arrow }] = await Promise.all([
        import("klinecharts"),
        import("@klinecharts/extension"),
      ]);
      if (disposed || !containerRef.current) return;
      // Đăng ký hình chữ nhật và mũi tên từ extension, các công cụ khác có sẵn
      registerOverlay(rect);
      registerOverlay(arrow);
      const chart = init(containerRef.current, {
        styles: {
          grid: { horizontal: { color: "#1c202b" }, vertical: { color: "#1c202b" } },
          candle: { bar: { upColor: "#3ecf8e", downColor: "#ef5f5f", upBorderColor: "#3ecf8e", downBorderColor: "#ef5f5f", upWickColor: "#3ecf8e", downWickColor: "#ef5f5f" } },
          xAxis: { tickText: { color: "#8b92a5" }, axisLine: { color: "#262b38" } },
          yAxis: { tickText: { color: "#8b92a5" }, axisLine: { color: "#262b38" } },
        },
      });
      if (!chart) return;
      chartRef.current = chart;
      chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod(periodFor(resolution));
      chart.setDataLoader({ getBars: ({ callback }: any) => callback(toKLines(barsRef.current)) });
      chart.createIndicator({ name: "MA", paneId: "candle_pane" }, true);
    })();
    return () => {
      disposed = true;
      feedRef.current?.close();
      if (chartRef.current) {
        import("klinecharts").then(({ dispose }) => dispose(chartRef.current));
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { from, to } = rangeForResolution(resolution);
      const bars = await fetchHistory(symbol, resolution, from, to);
      if (cancelled) return;
      barsRef.current = bars;
      currentBarRef.current = bars.at(-1);
      setLastPrice(currentBarRef.current ? currentBarRef.current.close.toFixed(2) : "N/A");
      const chart = chartRef.current;
      if (chart) {
        chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
        chart.setPeriod(periodFor(resolution));
        chart.resetData();
      }
    };
    load();
    feedRef.current?.close();
    feedRef.current = connectPriceFeed(symbol, (tick) => {
      const bucket = bucketStart(tick.time, resolution);
      currentBarRef.current = mergeTick(currentBarRef.current, tick.price, tick.volume, bucket);
      const bars = barsRef.current;
      if (bars.length && bars.at(-1)?.time === currentBarRef.current.time) bars[bars.length - 1] = currentBarRef.current;
      else bars.push(currentBarRef.current);
      chartRef.current?.resetData();
      setLastPrice(tick.price.toFixed(2));
    }, setStatus);
    return () => { cancelled = true; feedRef.current?.close(); };
  }, [symbol, resolution]);

  useEffect(() => {
    chartRef.current?.getOverlays().forEach((overlay: any) => {
      chartRef.current?.overrideOverlay({ id: overlay.id, lock: locked });
    });
  }, [locked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (overlayHistoryRef.current.length > 1) {
          overlayHistoryRef.current.pop();
          restoreOverlays(overlayHistoryRef.current.at(-1) ?? "[]");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const createOverlay = (name: string) => {
    if (locked || !chartRef.current) return;
    chartRef.current.createOverlay({ name, mode: "weak_magnet", modeSensitivity: 8, onDrawEnd: snapshotOverlays, onPressedMoveEnd: snapshotOverlays });
  };

  return (
    <div id="app">
      <header>
        <div className="symbol-row">
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{SYMBOLS.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={resolution} onChange={(event) => setResolution(event.target.value)}>{RESOLUTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <div className="engine-switch" role="group" aria-label="Chart engine">
            <button onClick={onSelectLightweight}>Lightweight</button>
            <button className="engine-switch--active">KLineChart</button>
          </div>
        </div>
        <div className="status-row"><span className={"dot " + (status === "connected" ? "dot--on" : "dot--off")} /><span>{status}</span><span id="last-price">{lastPrice}</span></div>
      </header>
      <div className="chart-shell">
        <aside className="kline-toolbar" aria-label="KLineChart native drawing tools">
          <div className="kline-toolbar__title">K</div>
          {OVERLAY_GROUPS.map((group, groupIndex) => (
            <div className="kline-toolbar__group" key={groupIndex}>
              {group.map((tool) => <button className="kline-tool-button" key={tool.name} title={tool.title} aria-label={tool.title} onClick={() => createOverlay(tool.name)} disabled={locked}>{tool.label}</button>)}
            </div>
          ))}
          <div className="kline-toolbar__hint">Right-click<br />to delete</div>
          <div className="kline-toolbar__group">
            <button className="kline-tool-button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => { if (overlayHistoryRef.current.length > 1) { overlayHistoryRef.current.pop(); restoreOverlays(overlayHistoryRef.current.at(-1) ?? "[]"); } }}>↶</button>
            <button className={"kline-tool-button " + (locked ? "kline-tool-button--active" : "")} title={locked ? "Unlock overlays" : "Lock overlays"} aria-label={locked ? "Unlock overlays" : "Lock overlays"} onClick={() => setLocked((value) => !value)}>{locked ? "🔒" : "🔓"}</button>
            <button className="kline-tool-button kline-tool-button--danger" title="Clear overlays" aria-label="Clear overlays" onClick={() => { snapshotOverlays(); chartRef.current?.removeOverlay(); snapshotOverlays(); }}>×</button>
          </div>
        </aside>
        <main id="kline-chart" ref={containerRef} />
      </div>
    </div>
  );
}
