"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LoadingNumber } from "./ui/Loading";
import { sortedTimezoneOptions } from "./chart/config/chart-timezones";
import { PRICE_AXIS_ICONS } from "./chart/layout/panes/price-axis-icons";
import { formatTimeInTimezone, getTimezoneOffsetString, millisecondsUntilNextSecond } from "./chart/core/chart-utils";

let clockTimestamp = 0;
let clockTimeout = 0;
const clockListeners = new Set<() => void>();
const clockSnapshot = () => clockTimestamp;
const serverClockSnapshot = () => 0;

// Giữ thời gian khi header được gắn lại và dùng chung một bộ hẹn giờ.
function updateClock() {
  window.clearTimeout(clockTimeout);
  clockTimestamp = Date.now();
  clockListeners.forEach(listener => listener());
  clockTimeout = window.setTimeout(updateClock, millisecondsUntilNextSecond(Date.now()) + 10);
}

function visibleClock() {
  if (document.visibilityState === "visible") updateClock();
}

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    updateClock();
    document.addEventListener("visibilitychange", visibleClock);
  }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size) {
      window.clearTimeout(clockTimeout);
      document.removeEventListener("visibilitychange", visibleClock);
    }
  };
}

export function WorkspaceClock({ timezone = "Asia/Bangkok", exchangeTimezone = "Asia/Bangkok", onTimezoneChange }: { timezone?: string; exchangeTimezone?: string; onTimezoneChange?: (timezone: string) => void }) {
  const timestamp = useSyncExternalStore(subscribeClock, clockSnapshot, serverClockSnapshot);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const effectiveTimezone = timezone === "exchange" ? exchangeTimezone : timezone;
  const timezoneOptions = useMemo(
    () => sortedTimezoneOptions(new Date(), exchangeTimezone),
    [exchangeTimezone, menuOpen],
  );

  const timeText = timestamp ? formatTimeInTimezone(new Date(timestamp), effectiveTimezone) : "";

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
            <span className="workspace-clock__text">
              <LoadingNumber loading={!timeText} template="00:00:00" label="Đang tải thời gian">{timeText}</LoadingNumber>{" "}
              <span className="workspace-clock__parenthesis">(</span>{currentOffset}<span className="workspace-clock__parenthesis">)</span>
            </span>
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
