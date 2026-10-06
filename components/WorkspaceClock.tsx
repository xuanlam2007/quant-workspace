"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sortedTimezoneOptions } from "./chart/config/chart-timezones";
import { PRICE_AXIS_ICONS } from "./chart/layout/price-axis-icons";
import { formatTimeInTimezone, getTimezoneOffsetString, millisecondsUntilNextSecond } from "./chart/core/chart-utils";

export function WorkspaceClock({ timezone = "Asia/Bangkok", exchangeTimezone = "Asia/Bangkok", onTimezoneChange }: { timezone?: string; exchangeTimezone?: string; onTimezoneChange?: (timezone: string) => void }) {
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
    const outside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); wrapperRef.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const currentOffset = getTimezoneOffsetString(effectiveTimezone).string;
  return (
        <div className="chart-footer__timezone-wrapper" ref={wrapperRef}>
          <button
            type="button" tabIndex={-1}
            className="chart-footer__timezone"
            data-name="time-zone-menu"
            data-tooltip="Múi giờ"
            aria-label="Múi giờ"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {timeText || `--:--:-- (${currentOffset})`}
          </button>
          {menuOpen && (
            <div className="chart-footer__timezone-menu" role="menu">
              {timezoneOptions.map((item) => {
                const isSelected = item.id === timezone;
                return (
                  <button
                    key={item.id}
                    type="button" tabIndex={-1}
                    role="menuitemradio"
                    aria-checked={isSelected}
                    className={`chart-footer__timezone-item ${isSelected ? "is-active" : ""}`}
                    onClick={() => {
                      onTimezoneChange?.(item.id);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="chart-footer__timezone-check">{isSelected ? PRICE_AXIS_ICONS.check : null}</span>
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
  );
}
