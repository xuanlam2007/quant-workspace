"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingIndicator } from "@/components/ui/Loading";
import { createPortal } from "react-dom";
import { getTimezoneOffsetString } from "../../core/chart-utils";
import { useDraggablePanel } from "../../ui/useDraggablePanel";

export const GO_TO_DATE_ICON = <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M11 4h-1v2H7.5A2.5 2.5 0 0 0 5 8.5V13h1v-2h16v8.5c0 .83-.67 1.5-1.5 1.5H14v1h6.5a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 20.5 6H18V4h-1v2h-6V4Zm6 4V7h-6v1h-1V7H7.5C6.67 7 6 7.67 6 8.5V10h16V8.5c0-.83-.67-1.5-1.5-1.5H18v1h-1Zm-5.15 10.15-3.5-3.5-.7.7L10.29 18H4v1h6.3l-2.65 2.65.7.7 3.5-3.5.36-.35-.36-.35Z" /></svg>;
const ARROW = <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M16.47 20.53a.75.75 0 1 0 1.06-1.06l-1.06 1.06zM11 14l-.53-.53c-.3.3-.3.77 0 1.06L11 14zm6.53-5.47a.75.75 0 0 0-1.06-1.06l1.06 1.06zm0 10.94l-6-6-1.06 1.06 6 6 1.06-1.06zm-6-4.94l6-6-1.06-1.06-6 6 1.06 1.06z" /></svg>;
const CLOSE = <svg viewBox="0 0 17 17" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="m.58 1.42.82-.82 15 15-.82.82z"/><path d="m.58 15.58 15-15 .82.82-15 15z"/></svg>;
const pad = (value: number) => String(value).padStart(2, "0");
const dateText = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const timeText = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function chartCalendarDate(seconds: number, timezone: string, daily = false) {
  const date = new Date(seconds * 1000);
  const wall = new Date(date.getTime() + (daily ? 0 : getTimezoneOffsetString(timezone, date).offsetMinutes * 60000));
  return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes());
}

export function calendarTimestamp(date: Date, timezone: string, daily: boolean) {
  const wall = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), daily ? 0 : date.getHours(), daily ? 0 : date.getMinutes());
  let utc = wall;
  // Tính lại độ lệch để xử lý múi giờ có giờ mùa hè.
  if (!daily) for (let attempt = 0; attempt < 3; attempt++) utc = wall - getTimezoneOffsetString(timezone, new Date(utc)).offsetMinutes * 60000;
  return utc / 1000;
}

function parseDate(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(year, month - 1, day, hour, minute);
  return year >= 1000 && dateText(result) === date && timeText(result) === time ? result : null;
}

function TimeField({ value, disabled, onPick }: { value: string; disabled: boolean; onPick: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(value);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 100, height: 231 });
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(value); setHovered(value); }, [value]);
  const options = Array.from({ length: 96 }, (_, index) => `${pad(Math.floor(index / 4))}:${pad(index % 4 * 15)}`);
  if (!options.includes(value)) options.push(value);
  if (/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(text) && !options.includes(text)) options.push(text);
  options.sort();
  const commit = (raw: string) => {
    const [hour = "", minute = ""] = raw.split(":");
    const normalized = `${pad(Math.max(0, Math.min(23, Number(hour) || 0)))}:${pad(Math.max(0, Math.min(59, Number(minute.padEnd(2, "0")) || 0)))}`;
    setText(normalized); onPick(normalized); setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const height = Math.min(231, Math.max(below, above));
      setBounds({ left: rect.left, top: below >= 231 || below >= above ? rect.bottom : rect.top - height, width: rect.width, height });
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !input.current?.parentElement?.contains(event.target)) { input.current?.blur(); setOpen(false); }
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector('[data-hovered="true"]')?.scrollIntoView({ block: "nearest", behavior: hovered === value ? "auto" : "smooth" }); }, [hovered, open, value]);
  return <div className="go-to-date-time" data-time-menu-open={open}>
    <input ref={input} tabIndex={-1} inputMode="numeric" aria-label="Thời gian" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} value={text} maxLength={5} onFocus={(event) => { event.currentTarget.select(); setOpen(true); }} onBlur={() => commit(text)} onChange={(event) => { const raw = event.target.value.replace(/[^0-9:]/g, ""); const next = raw.length === 3 && !raw.includes(":") ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw; setText(next); setHovered(next); }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); input.current?.blur(); }
      if (event.key === "Enter") { event.preventDefault(); commit(open ? hovered : text); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setHovered(options[(Math.max(0, options.indexOf(hovered)) + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]); }
    }} />
    <svg viewBox="0 0 17 17" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M1 8.5a7.5 7.5 0 1 1 15 0 7.5 7.5 0 0 1-15 0zM8.5 0a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 9V3H8v5H5v1h4z"/></svg>
    {open && createPortal(<div ref={menu} className="go-to-date-time-menu" role="listbox" aria-label="Thời gian" style={bounds}>{options.map((option) => <button key={option} type="button" tabIndex={-1} role="option" aria-selected={option === value} data-hovered={option === hovered} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setHovered(option)} onClick={() => { commit(option); }}>{option}</button>)}</div>, document.body)}
  </div>;
}

interface Props {
  timezone: string;
  daily: boolean;
  initialRange: { from: number; to: number };
  onClose: () => void;
  onNavigate: (from: number, to?: number) => Promise<void>;
  dateOnly?: boolean;
  title?: string;
  submitLabel?: string;
}

export function GoToDateDialog({ timezone, daily, initialRange, onClose, onNavigate, dateOnly = false, title = "Đi đến", submitLabel = "Đi đến" }: Props) {
  const [tab, setTab] = useState<"Date" | "CustomRange">(() => {
    if (dateOnly) return "Date";
    try { return localStorage.getItem("GoToDialog.activeTab") === "CustomRange" ? "CustomRange" : "Date"; } catch { return "Date"; }
  });
  const [picked] = useState(() => {
    if (dateOnly) return chartCalendarDate(initialRange.from, timezone, daily);
    try {
      const saved = sessionStorage.getItem("goToDateTabLastPickedDate");
      if (saved && Number.isFinite(new Date(Number(saved)).valueOf())) return new Date(Number(saved));
    } catch { /* Bộ nhớ trình duyệt có thể bị chặn. */ }
    const today = new Date(); today.setHours(0, 0, 0, 0); return today;
  });
  const [dates, setDates] = useState(() => [picked, chartCalendarDate(initialRange.from, timezone, daily), chartCalendarDate(initialRange.to, timezone, daily)].map(dateText));
  const [times, setTimes] = useState(() => [picked, chartCalendarDate(initialRange.from, timezone, daily), chartCalendarDate(initialRange.to, timezone, daily)].map(timeText));
  const [active, setActive] = useState(tab === "Date" ? 0 : 1);
  const [month, setMonth] = useState(() => new Date(picked.getFullYear(), picked.getMonth(), 1));
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const drag = useDraggablePanel(true);
  const parsed = dates.map((date, index) => parseDate(date, daily ? "00:00" : times[index]));
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const valid = tab === "Date" ? parsed[0] !== null && parsed[0] <= today : parsed[1] !== null && parsed[2] !== null && parsed[1] <= parsed[2];
  useEffect(() => {
    alive.current = true;
    inputs.current[tab === "Date" ? 0 : 1]?.focus();
    return () => { alive.current = false; };
  }, [tab]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Tab") event.preventDefault(); if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest('[data-time-menu-open="true"]'))) { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const focusDate = (index: number) => {
    setActive(index);
    const date = parsed[index];
    if (date) setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };
  const choose = (date: Date) => {
    setDates((current) => current.map((value, index) => index === active ? dateText(date) : value));
    setError("");
    if (active === 1) { setActive(2); inputs.current[2]?.focus(); }
  };
  const disabledDate = (date: Date) => {
    const text = dateText(date);
    return tab === "Date" ? text > dateText(today) : active === 1 ? text > dates[2] : text < dates[1];
  };
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      const from = parsed[tab === "Date" ? 0 : 1]!;
      if (tab === "Date" && !dateOnly) { try { sessionStorage.setItem("goToDateTabLastPickedDate", String(from.valueOf())); } catch { /* Bộ nhớ trình duyệt có thể bị chặn. */ } }
      await onNavigate(calendarTimestamp(from, timezone, daily), tab === "CustomRange" ? calendarTimestamp(parsed[2]!, timezone, daily) : undefined);
      if (alive.current) onClose();
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Không thể tải dữ liệu");
    } finally { if (alive.current) setBusy(false); }
  };
  const year = month.getFullYear();
  const monthNumber = month.getMonth();
  const yearStart = Math.floor(year / 20) * 20;
  const firstWeekday = (new Date(year, monthNumber, 1).getDay() + 6) % 7;
  const days = new Date(year, monthNumber + 1, 0).getDate();
  const shift = (direction: number) => setMonth(new Date(year + (view === "years" ? direction * 20 : view === "months" ? direction : 0), monthNumber + (view === "days" ? direction : 0), 1));
  return <div className="go-to-date-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="go-to-date-dialog" role="dialog" aria-modal="true" aria-labelledby="go-to-date-title" style={drag.style} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <header {...drag.handle}><h2 id="go-to-date-title">{title}</h2><button type="button" tabIndex={-1} aria-label="Đóng" onClick={onClose}>{CLOSE}</button></header>
      {!dateOnly && <div className="go-to-date-tabs" role="tablist">{(["Date", "CustomRange"] as const).map((value) => <button key={value} type="button" role="tab" tabIndex={-1} aria-selected={tab === value} onClick={() => {
        setTab(value); focusDate(value === "Date" ? 0 : 1); setError("");
        try { localStorage.setItem("GoToDialog.activeTab", value); } catch { /* Bộ nhớ trình duyệt có thể bị chặn. */ }
      }}>{value === "Date" ? "Ngày" : "Phạm vi tùy chỉnh"}</button>)}</div>}
      <div className="go-to-date-content">
        {(tab === "Date" ? [0] : [1, 2]).map((index) => <div className="go-to-date-row" key={index}>
          <input ref={(element) => { inputs.current[index] = element; }} tabIndex={-1} aria-label={index === 2 ? "Ngày kết thúc" : "Ngày bắt đầu"} aria-invalid={!parsed[index]} className={active === index ? "is-active" : ""} value={dates[index]} placeholder="yyyy-mm-dd" onFocus={() => focusDate(index)} onChange={(event) => { setDates((current) => current.map((value, i) => i === index ? event.target.value : value)); const next = parseDate(event.target.value, times[index]); if (next) setMonth(new Date(next.getFullYear(), next.getMonth(), 1)); setError(""); }} />
          {!dateOnly && <TimeField disabled={daily} value={times[index]} onPick={(picked) => setTimes((current) => current.map((value, i) => i === index ? picked : value))} />}
        </div>)}
        <div className="go-to-date-calendar" onKeyDown={(event) => {
          if (!(event.target instanceof HTMLButtonElement) || view !== "days") return;
          const label = event.target.getAttribute("aria-label");
          const date = label ? parseDate(label, "00:00") : null;
          if (!date) return;
          const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
          if (!delta && !["PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          if (delta) date.setDate(date.getDate() + delta);
          else if (event.key === "PageUp" || event.key === "PageDown") date.setMonth(date.getMonth() + (event.key === "PageUp" ? -1 : 1));
          else date.setDate(event.key === "Home" ? 1 : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
          if (disabledDate(date)) return;
          setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
          const calendar = event.currentTarget;
          requestAnimationFrame(() => calendar.querySelector<HTMLButtonElement>(`button[aria-label="${dateText(date)}"]`)?.focus());
        }}>
          <div className="go-to-date-calendar-header">
            <button type="button" tabIndex={-1} aria-label="Trước" onClick={() => shift(-1)}>{ARROW}</button>
            <button type="button" tabIndex={-1} onClick={() => setView(view === "days" ? "months" : view === "months" ? "years" : "days")}>{view === "days" ? `Tháng ${monthNumber + 1} ${year}` : view === "months" ? year : `${yearStart} - ${yearStart + 19}`}</button>
            <button type="button" tabIndex={-1} aria-label="Sau" className="go-to-date-next" onClick={() => shift(1)}>{ARROW}</button>
          </div>
          {view === "days" ? <>
            <div className="go-to-date-weekdays">{["Mo", "Thứ 3", "T4", "Th", "Fr", "Sa", "Su"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="go-to-date-days">{Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: days }, (_, index) => {
              const date = new Date(year, monthNumber, index + 1); const text = dateText(date);
              const selected = text === dates[active] || (tab === "CustomRange" && (text === dates[1] || text === dates[2]));
              return <button type="button" tabIndex={-1} key={text} aria-label={text} aria-pressed={selected} disabled={disabledDate(date)} className={[text === dateText(today) ? "is-today" : "", tab === "CustomRange" && text > dates[1] && text < dates[2] ? "is-in-range" : ""].join(" ")} onClick={() => choose(date)}>{index + 1}</button>;
            })}</div>
          </> : <div className={`go-to-date-grid go-to-date-grid--${view}`}>{Array.from({ length: view === "months" ? 12 : 20 }, (_, index) => <button type="button" tabIndex={-1} key={index} onClick={() => { setMonth(new Date(view === "months" ? year : yearStart + index, view === "months" ? index : monthNumber, 1)); setView(view === "years" ? "months" : "days"); }}>{view === "months" ? `Tháng ${index + 1}` : yearStart + index}</button>)}</div>}
        </div>
        {(!valid || error) && <div className="go-to-date-error" role="alert">{error || "Vui lòng nhập đúng ngày và phạm vi thời gian"}</div>}
      </div>
      <footer><button type="button" tabIndex={-1} onClick={onClose}>Hủy bỏ</button><button type="submit" tabIndex={-1} disabled={!valid || busy}>{busy ? <LoadingIndicator label="Đang tải" /> : submitLabel}</button></footer>
    </form>
  </div>;
}
