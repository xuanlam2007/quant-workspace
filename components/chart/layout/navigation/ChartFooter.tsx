import { GO_TO_DATE_ICON } from "./GoToDateDialog";
import { RANGE_PRESETS, type RangePreset, type ScaleMode } from "../../config/chart-config";

interface ChartFooterProps {
  rangeDays?: number;
  scaleMode: ScaleMode;
  autoScale: boolean;
  onRangeChange: (preset?: RangePreset) => void;
  onGoToDate: () => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  onAutoScaleToggle: () => void;
}

export function ChartFooter({
  rangeDays,
  scaleMode,
  autoScale,
  onRangeChange,
  onGoToDate,
  onScaleModeChange,
  onAutoScaleToggle,
}: ChartFooterProps) {
  return (
    <footer className="chart-footer">
      <div className="range-presets" aria-label="History range">
        {RANGE_PRESETS.map((preset) => (
          <button key={preset.label} type="button" tabIndex={-1} aria-pressed={rangeDays === preset.days} className={rangeDays === preset.days ? "chart-footer__active" : ""} onClick={() => onRangeChange(preset)}>
            {preset.label}
          </button>
        ))}
        <span className="chart-footer__separator" aria-hidden="true" />
        <button type="button" tabIndex={-1} className="chart-footer__go-to-date" data-tooltip="Đi đến" data-tooltip-hotkey="Alt + G" aria-label="Đi đến ngày" onClick={onGoToDate}>{GO_TO_DATE_ICON}</button>
      </div>
      <div className="chart-footer__settings">

        <button className={scaleMode === "percent" ? "chart-footer__active" : ""} onClick={() => onScaleModeChange(scaleMode === "percent" ? "normal" : "percent")}>%</button>
        <button className={scaleMode === "log" ? "chart-footer__active" : ""} onClick={() => onScaleModeChange(scaleMode === "log" ? "normal" : "log")}>log</button>
        <button className={autoScale ? "chart-footer__active" : ""} disabled={scaleMode === "percent" || scaleMode === "indexed"} onClick={onAutoScaleToggle}>tự động</button>
      </div>
    </footer>
  );
}
