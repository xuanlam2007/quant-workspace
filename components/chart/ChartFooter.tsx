import { RANGE_PRESETS, type RangePreset, type ScaleMode } from "./chart-config";

interface ChartFooterProps {
  rangeDays?: number;
  scaleMode: ScaleMode;
  autoScale: boolean;
  onRangeChange: (preset?: RangePreset) => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  onAutoScaleToggle: () => void;
}

export function ChartFooter({ rangeDays, scaleMode, autoScale, onRangeChange, onScaleModeChange, onAutoScaleToggle }: ChartFooterProps) {
  return (
    <footer className="chart-footer">
      <div className="range-presets" aria-label="History range">
        {RANGE_PRESETS.map((preset) => (
          <button key={preset.label} className={rangeDays === preset.days ? "chart-footer__active" : ""} onClick={() => onRangeChange(preset)}>
            {preset.label}
          </button>
        ))}
        <button title="Return to the selected timeframe's default history" onClick={() => onRangeChange()}>↻</button>
      </div>
      <div className="chart-footer__settings">
        <span>UTC+7</span>
        <button className={scaleMode === "percent" ? "chart-footer__active" : ""} onClick={() => onScaleModeChange(scaleMode === "percent" ? "normal" : "percent")}>%</button>
        <button className={scaleMode === "log" ? "chart-footer__active" : ""} onClick={() => onScaleModeChange(scaleMode === "log" ? "normal" : "log")}>log</button>
        <button className={autoScale ? "chart-footer__active" : ""} onClick={onAutoScaleToggle}>tự động</button>
      </div>
    </footer>
  );
}
