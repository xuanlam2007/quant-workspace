import type { Bar } from "@/lib/dchart-api";
import { RESOLUTIONS, type MaType } from "./chart-config";
import { formatVolume } from "./chart-utils";

interface MarketDataPanelProps {
  symbol: string;
  resolution: string;
  quoteBar?: Bar;
  previousClose?: number;
  volumeEnabled: boolean;
  currentVolumeMa?: number;
  maLength: number;
  maType: MaType;
  smoothingLength: number;
  onMaLengthChange: (length: number) => void;
  onMaTypeChange: (type: MaType) => void;
  onSmoothingLengthChange: (length: number) => void;
}

export function MarketDataPanel({
  symbol,
  resolution,
  quoteBar,
  previousClose,
  volumeEnabled,
  currentVolumeMa,
  maLength,
  maType,
  smoothingLength,
  onMaLengthChange,
  onMaTypeChange,
  onSmoothingLengthChange,
}: MarketDataPanelProps) {
  const change = quoteBar && previousClose ? quoteBar.close - previousClose : 0;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  const quoteClass = change >= 0 ? "quote--up" : "quote--down";

  return (
    <>
      <div className="market-data-row">
        <div className="market-data__title">
          <strong>{symbol}</strong><span>·</span><span>{RESOLUTIONS.find((item) => item.value === resolution)?.label}</span><span>· HOSE</span>
        </div>
        <div className="ohlcv-strip" aria-label="Open high low close volume">
          <span>O <b>{quoteBar?.open.toFixed(2) ?? "N/A"}</b></span>
          <span>H <b>{quoteBar?.high.toFixed(2) ?? "N/A"}</b></span>
          <span>L <b>{quoteBar?.low.toFixed(2) ?? "N/A"}</b></span>
          <span>C <b className={quoteClass}>{quoteBar?.close.toFixed(2) ?? "N/A"}</b></span>
          {previousClose !== undefined && <span className={quoteClass}>{change >= 0 ? "+" : ""}{change.toFixed(2)} ({changePercent.toFixed(2)}%)</span>}
          <span className="ohlcv-strip__volume">Vol <b>{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</b></span>
        </div>
        {volumeEnabled && (
          <label className="ma-control" title="Volume MA settings">
            MA
            <input type="number" min="2" max="500" value={maLength} aria-label="MA length" onChange={(event) => onMaLengthChange(Math.max(2, Math.min(500, Number(event.target.value) || 2)))} />
            <select value={maType} onChange={(event) => onMaTypeChange(event.target.value as MaType)} aria-label="MA type">
              <option value="SMA">SMA</option>
              <option value="EMA">EMA</option>
              <option value="WMA">WMA</option>
            </select>
            <input type="number" min="1" max="500" value={smoothingLength} aria-label="Smoothing length" onChange={(event) => onSmoothingLengthChange(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
          </label>
        )}
      </div>
      {volumeEnabled && (
        <div className="indicator-data-row">
          <span className="indicator-data__name">Khối lượng {maLength} {maType} {smoothingLength}</span>
          <span className="indicator-data__volume">{quoteBar ? formatVolume(quoteBar.volume) : "N/A"}</span>
          <span className="indicator-data__ma">{currentVolumeMa !== undefined ? formatVolume(currentVolumeMa) : "N/A"}</span>
          <span className="indicator-data__actions" title="Volume indicator controls">◉ ⚙ × ···</span>
        </div>
      )}
    </>
  );
}
