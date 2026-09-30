"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

// Bảng màu và thứ tự lấy từ các mô-đun 6914 và 48891 của bundle.
const palette = [
  "#ffffff", "#d1d4dc", "#b2b5be", "#9598a1", "#787b86", "#5d606b", "#434651", "#2a2e39", "#131722", "#000000",
  "#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63",
  "#fccbcd", "#ffe0b2", "#fff9c4", "#c8e6c9", "#ace5dc", "#b2ebf2", "#bbd9fb", "#d1c4e9", "#e1bee7", "#f8bbd0",
  "#faa1a4", "#ffcc80", "#fff59d", "#a5d6a7", "#70ccbd", "#80deea", "#90bff9", "#b39ddb", "#ce93d8", "#f48fb1",
  "#f77c80", "#ffb74d", "#fff176", "#81c784", "#42bda8", "#4dd0e1", "#5b9cf6", "#9575cd", "#ba68c8", "#f06292",
  "#f7525f", "#ffa726", "#ffee58", "#66bb6a", "#22ab94", "#26c6da", "#3179f5", "#7e57c2", "#ab47bc", "#ec407a",
  "#b22833", "#f57c00", "#fbc02d", "#388e3c", "#056656", "#0097a7", "#1848cc", "#512da8", "#7b1fa2", "#c2185b",
  "#801922", "#e65100", "#f57f17", "#1b5e20", "#00332a", "#006064", "#0c3299", "#311b92", "#4a148c", "#880e4f",
];

export function splitChartColor(value: string) {
  const hex = value.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((part) => part + part).join("") : hex;
    return { color: "#" + full.slice(0, 6), opacity: full.length === 8 ? Math.round(parseInt(full.slice(6), 16) / 255 * 100) : 100 };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (rgb) return { color: "#" + rgb.slice(1, 4).map((part) => Math.round(Number(part)).toString(16).padStart(2, "0")).join(""), opacity: Math.round(Number(rgb[4] ?? 1) * 100) };
  return { color: "#000000", opacity: value === "transparent" ? 0 : 100 };
}

export const withChartOpacity = (color: string, opacity: number) => splitChartColor(color).color + (opacity >= 100 ? "" : Math.round(Math.max(0, opacity) / 100 * 255).toString(16).padStart(2, "0"));

function toHsv(color: string) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = (max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function fromHsv({ h, s, v }: ReturnType<typeof toHsv>) {
  const sector = Math.floor(h * 6), fraction = h * 6 - sector;
  const p = v * (1 - s), q = v * (1 - fraction * s), t = v * (1 - (1 - fraction) * s);
  return "#" + [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][sector % 6].map((part) => Math.round(part * 255).toString(16).padStart(2, "0")).join("");
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  preview?: "swatch" | "line";
  disabled?: boolean;
}

export function ChartColorPicker({ value, onChange, label, preview = "swatch", disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const { color, opacity } = splitChartColor(value);
  const [hex, setHex] = useState(color.slice(1));
  const [hsv, setHsv] = useState(() => toHsv(color));
  const [opacityText, setOpacityText] = useState(String(opacity));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [removeColor, setRemoveColor] = useState<number | null>(null);

  useEffect(() => { setHex(color.slice(1)); setOpacityText(String(opacity)); }, [color, opacity]);
  useEffect(() => {
    if (!open) return;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem("pickerCustomColors") ?? "[]");
      if (Array.isArray(stored)) setCustomColors(stored.filter((item): item is string => typeof item === "string" && /^#[\da-f]{6}$/i.test(item)).slice(-29));
    } catch { setCustomColors([]); }
    const close = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", escape, true); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect(), panel = panelRef.current;
      if (!anchor || !panel) return;
      const width = panel.offsetWidth, height = panel.offsetHeight;
      setPosition({ left: Math.max(4, Math.min(anchor.left, window.innerWidth - width - 4)), top: Math.max(4, anchor.bottom + height <= window.innerHeight - 4 ? anchor.bottom : anchor.top >= height + 4 ? anchor.top - height : window.innerHeight - height - 4) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, customOpen]);

  const choose = (next: string, close = true) => { onChange(withChartOpacity(next, opacity)); if (close) setOpen(false); };
  const saveCustom = (next: string[]) => { setCustomColors(next); try { localStorage.setItem("pickerCustomColors", JSON.stringify(next)); } catch { /* Bộ nhớ có thể bị trình duyệt giới hạn. */ } };
  const changeHsv = (next: ReturnType<typeof toHsv>) => { setHsv(next); choose(fromHsv(next), false); };
  const dragColor = (event: ReactPointerEvent<HTMLDivElement>, hue: boolean) => {
    if (event.type === "pointermove" && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    changeHsv(hue ? { ...hsv, h: clamp((event.clientY - rect.top) / rect.height) } : { ...hsv, s: clamp((event.clientX - rect.left) / rect.width), v: 1 - clamp((event.clientY - rect.top) / rect.height) });
  };
  const swatch = (next: string, index?: number) => <button key={next + ":" + (index ?? "palette")} type="button" tabIndex={-1} className={next.toLowerCase() === color.toLowerCase() ? "is-active" : ""} aria-label={next} aria-pressed={next.toLowerCase() === color.toLowerCase()} onClick={() => choose(next)} onContextMenu={index === undefined ? undefined : (event) => { event.preventDefault(); setRemoveColor(index); }} style={{ color: next, backgroundColor: next }}/>;

  return <>
    <button ref={buttonRef} type="button" tabIndex={-1} disabled={disabled} className={"chart-color-picker__trigger chart-color-picker__trigger--" + preview} aria-label={label} aria-expanded={open} onClick={() => { setCustomOpen(false); setRemoveColor(null); setHsv(toHsv(color)); setOpen(!open); }}>
      <span className="chart-color-picker__checker"><i style={{ backgroundColor: value }}/></span>
      {preview === "line" && <span className="chart-color-picker__line" style={{ backgroundColor: value }}/>}
    </button>
    {open && createPortal(<div ref={panelRef} className="chart-color-picker__panel" role="dialog" aria-label={label} style={position}>
      {customOpen ? <>
        <div className="chart-color-picker__custom-form">
          <span className="chart-color-picker__custom-preview" style={{ background: color }}/>
          <label className="chart-color-picker__hex"><span>#</span><input tabIndex={-1} aria-label="Mã màu HEX" value={hex} maxLength={6} onChange={(event) => { const next = event.target.value.replace(/^#/, ""); setHex(next); if (/^[\da-f]{6}$/i.test(next)) { setHsv(toHsv("#" + next)); choose("#" + next, false); } }}/></label>
          <button type="button" tabIndex={-1} onClick={() => { if (!customColors.some((item) => item.toLowerCase() === color.toLowerCase())) saveCustom([...customColors, color].slice(-29)); setCustomOpen(false); }}>Thêm</button>
        </div>
        <div className="chart-color-picker__custom-map">
          <div className="chart-color-picker__saturation" style={{ backgroundColor: "hsl(" + hsv.h * 360 + ", 100%, 50%)" }} onPointerDown={(event) => dragColor(event, false)} onPointerMove={(event) => dragColor(event, false)}><i style={{ left: hsv.s * 100 + "%", top: (1 - hsv.v) * 100 + "%" }}/></div>
          <div className="chart-color-picker__hue" onPointerDown={(event) => dragColor(event, true)} onPointerMove={(event) => dragColor(event, true)}><i style={{ top: hsv.h * 100 + "%" }}/></div>
        </div>
      </> : <>
        <div className="chart-color-picker__palette">{palette.slice(0, 20).map((next) => swatch(next))}</div>
        <div className="chart-color-picker__palette">{palette.slice(20).map((next) => swatch(next))}</div>
        <div className="chart-color-picker__separator"/>
        <div className="chart-color-picker__palette chart-color-picker__custom-colors">
          {customColors.map((next, index) => swatch(next, index))}
          <button type="button" tabIndex={-1} className="chart-color-picker__custom-toggle" aria-label="Màu tùy chỉnh" onClick={() => { setHsv(toHsv(color)); setCustomOpen(true); }}/>
        </div>
        {removeColor !== null && <button type="button" tabIndex={-1} className="chart-color-picker__remove" onClick={() => { saveCustom(customColors.filter((_, index) => index !== removeColor)); setRemoveColor(null); }}>Loại bỏ màu</button>}
        <span className="chart-color-picker__opacity-label">Độ mờ</span>
        <div className="chart-color-picker__opacity">
          <div className="chart-color-picker__opacity-track" style={{ color }}><span style={{ backgroundImage: "linear-gradient(90deg, transparent, " + color + ")" }}/><input aria-label="Độ mờ" type="range" tabIndex={-1} min="0" max="100" value={opacity} onChange={(event) => onChange(withChartOpacity(color, Number(event.target.value)))}/></div>
          <label className="chart-color-picker__opacity-number"><input aria-label="Phần trăm độ mờ" tabIndex={-1} inputMode="numeric" value={opacityText} onChange={(event) => { const next = event.target.value; setOpacityText(next); if (/^\d{1,3}$/.test(next) && Number(next) <= 100) onChange(withChartOpacity(color, Number(next))); }} onBlur={() => setOpacityText(String(opacity))}/><span>%</span></label>
        </div>
      </>}
    </div>, document.body)}
  </>;
}
