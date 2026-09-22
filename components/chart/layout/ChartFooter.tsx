import { useEffect, useMemo, useRef, useState } from "react";
import { RANGE_PRESETS, type RangePreset, type ScaleMode } from "../config/chart-config";
import { sortedTimezoneOptions } from "../config/chart-timezones";
import { formatTimeInTimezone, getTimezoneOffsetString, millisecondsUntilNextSecond } from "../core/chart-utils";

interface ChartFooterProps {
  rangeDays?: number;
  scaleMode: ScaleMode;
  autoScale: boolean;
  timezone?: string;
  exchangeTimezone?: string;
  onRangeChange: (preset?: RangePreset) => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  onAutoScaleToggle: () => void;
  onTimezoneChange?: (timezone: string) => void;
}

export function ChartFooter({
  rangeDays,
  scaleMode,
  autoScale,
  timezone = "Asia/Bangkok",
  exchangeTimezone = "Asia/Bangkok",
  onRangeChange,
  onScaleModeChange,
  onAutoScaleToggle,
  onTimezoneChange,
}: ChartFooterProps) {
  const [timeText, setTimeText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const effectiveTimezone = timezone === "exchange" ? exchangeTimezone : timezone;
  const timezoneOptions = useMemo(
    () => sortedTimezoneOptions(new Date(), exchangeTimezone),
    [exchangeTimezone, menuOpen],
  );

  useEffect(() => {
    let timeoutId = 0;
    const updateTime = () => {
      const now = new Date();
      const time = formatTimeInTimezone(now, effectiveTimezone);
      const { string: offsetStr } = getTimezoneOffsetString(effectiveTimezone, now);
      setTimeText(`${time} (${offsetStr})`);
      timeoutId = window.setTimeout(updateTime, millisecondsUntilNextSecond(Date.now()) + 10);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timeoutId);
      updateTime();
    };

    updateTime();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [effectiveTimezone]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const currentOffset = getTimezoneOffsetString(effectiveTimezone).string;

  return (
    <footer className="chart-footer">
      <div className="range-presets" aria-label="History range">
        {RANGE_PRESETS.map((preset) => (
          <button key={preset.label} className={rangeDays === preset.days ? "chart-footer__active" : ""} onClick={() => onRangeChange(preset)}>
            {preset.label}
          </button>
        ))}
        <button data-tooltip="Trở về phạm vi mặc định của khung thời gian" aria-label="Trở về phạm vi mặc định" onClick={() => onRangeChange()}>↻</button>
      </div>
      <div className="chart-footer__settings">
        <div className="chart-footer__timezone-wrapper" ref={wrapperRef}>
          <button
            type="button"
            className="chart-footer__timezone"
            data-name="time-zone-menu"
            data-tooltip="Múi giờ"
            aria-label="Múi giờ"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {timeText || `(${currentOffset})`}
          </button>
          {menuOpen && (
            <div className="chart-footer__timezone-menu" role="menu">
              {timezoneOptions.map((item) => {
                const isSelected = item.id === timezone;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    className={`chart-footer__timezone-item ${isSelected ? "is-active" : ""}`}
                    onClick={() => {
                      onTimezoneChange?.(item.id);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="chart-footer__timezone-check">{isSelected ? "✓" : ""}</span>
                    {item.id !== "Etc/UTC" && item.id !== "exchange" && (
                      <span className="chart-footer__timezone-offset">({item.offset})</span>
                    )}
                    <span className="chart-footer__timezone-label">{item.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="chart-footer__separator" aria-hidden="true" />
        <button className={scaleMode === "percent" ? "chart-footer__active" : ""} onClick={() => onScaleModeChange(scaleMode === "percent" ? "normal" : "percent")}>%</button>
        <button className={scaleMode === "log" ? "chart-footer__active" : ""} onClick={() => onScaleModeChange(scaleMode === "log" ? "normal" : "log")}>log</button>
        <button className={autoScale ? "chart-footer__active" : ""} onClick={onAutoScaleToggle}>tự động</button>
      </div>
    </footer>
  );
}
