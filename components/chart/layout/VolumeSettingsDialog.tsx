"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MaType } from "../config/chart-config";
import { useDraggablePanel } from "../ui/useDraggablePanel";
import { ChartColorPicker } from "./ChartColorPicker";

export type VolumePlotStyle = "line" | "dashed" | "step" | "curved";

export interface VolumeSettings {
  maLength: number;
  smoothingType: MaType;
  smoothingLength: number;
  colorByPreviousClose: boolean;
  histogramVisible: boolean;
  maVisible: boolean;
  smoothedVisible: boolean;
  upColor: string;
  downColor: string;
  maColor: string;
  smoothedColor: string;
  maPlotStyle: VolumePlotStyle;
  smoothedPlotStyle: VolumePlotStyle;
  maPriceLineVisible: boolean;
  smoothedPriceLineVisible: boolean;
  scaleLabelVisible: boolean;
  statusValueVisible: boolean;
  visibleIntervals: boolean[];
}

interface Props {
  settings: VolumeSettings;
  onApply: (settings: VolumeSettings) => void;
  onClose: () => void;
}

const intervals = [
  ["Sóng nhỏ", "1", "59"],
  ["Giờ", "1", "24"],
  ["Ngày", "1", "366"],
  ["Tuần", "1", "52"],
  ["Tháng", "1", "12"],
] as const;

const plotStyles: { id: VolumePlotStyle; label: string; path: string }[] = [
  { id: "line", label: "Đường thẳng", path: "M2 14 8 8 13 11 20 4" },
  { id: "dashed", label: "Các đường gãy", path: "M2 13 5 10m3-2 3-3m3 0 3-3m2-1 2-1" },
  { id: "step", label: "Đường có bậc và ngắt quãng", path: "M2 15V9h6V5h6v6h6V3" },
  { id: "curved", label: "Đường cong", path: "M2 14C7 14 7 4 12 7S16 16 20 3" },
];
const additionalPlotStyles = [
  "Biểu đồ Đường bậc", "Bước đường có hình thoi", "Biểu đồ tần suất", "Chéo nhau",
  "Biểu đồ vùng", "Vùng gãy", "Các cột", "Các vòng tròn",
];

function PlotStylePicker({ value, onChange, priceLineVisible, onPriceLineChange }: { value: VolumePlotStyle; onChange: (value: VolumePlotStyle) => void; priceLineVisible: boolean; onPriceLineChange: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!buttonRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  const icon = (path: string) => <svg viewBox="0 0 22 18" width="22" height="18" fill="none" aria-hidden="true"><path d={path} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  return <>
    <button ref={buttonRef} type="button" tabIndex={-1} className="volume-dialog__plot-trigger" aria-label="Kiểu hiển thị" aria-expanded={open} onClick={() => {
      if (!open && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 294)), top: Math.max(8, Math.min(rect.top, window.innerHeight - 530)) });
      }
      setOpen((current) => !current);
    }}>{icon(plotStyles.find((style) => style.id === value)?.path ?? plotStyles[0].path)}</button>
    {open && createPortal(<div ref={menuRef} className="volume-dialog__plot-menu" role="menu" aria-label="Kiểu hiển thị" style={position}>
      <label className="volume-dialog__plot-price">Đường Giá<input type="checkbox" tabIndex={-1} checked={priceLineVisible} onChange={(event) => onPriceLineChange(event.target.checked)}/></label>
      {plotStyles.map((style) => <button type="button" tabIndex={-1} role="menuitemradio" aria-checked={style.id === value} key={style.id} className={style.id === value ? "is-active" : ""} onClick={() => { onChange(style.id); setOpen(false); }}>{icon(style.path)}{style.label}</button>)}
      {additionalPlotStyles.map((label) => <button type="button" tabIndex={-1} key={label} disabled title="Chưa hỗ trợ">{icon("M2 14h4v-5h4v3h4V5h4v9")}{label}</button>)}
    </div>, document.body)}
  </>;
}

export function VolumeSettingsDialog({ settings, onApply, onClose }: Props) {
  const drag = useDraggablePanel(true);
  const [tab, setTab] = useState<"inputs" | "style" | "visibility">("inputs");
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onClose]);
  const set = <K extends keyof VolumeSettings>(key: K, value: VolumeSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return <div className="volume-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="volume-dialog" style={drag.style} role="dialog" aria-modal="true" aria-label="Volume">
      <header {...drag.handle}><h2>Volume</h2><button type="button" tabIndex={-1} aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true"><path d="M3 3 21 21M21 3 3 21" stroke="currentColor" strokeWidth="1.5"/></svg></button></header>
      <nav aria-label="Volume settings tabs">
        {([ ["inputs", "Các đầu vào"], ["style", "Định dạng"], ["visibility", "Hiển thị"] ] as const).map(([id, label]) =>
          <button type="button" tabIndex={-1} key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div className="volume-dialog__content">
        {tab === "inputs" && <>
          <label className="volume-dialog__check"><input type="radio" tabIndex={-1} checked readOnly/>Mã giao dịch biểu đồ chính</label>
          <label className="volume-dialog__check volume-dialog__check--muted"><input type="radio" tabIndex={-1} disabled/>Mã giao dịch khác</label>
          <label className="volume-dialog__row"><span>Chiều dài MA</span><input type="number" tabIndex={-1} min="1" max="2000" value={draft.maLength} onChange={(event) => set("maLength", Math.max(1, Math.min(2000, Number(event.target.value) || 1)))}/></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.colorByPreviousClose} onChange={(event) => set("colorByPreviousClose", event.target.checked)}/>Dựa trên màu của phiên đóng cửa trước</label>
          <label className="volume-dialog__row"><span>Chiều dài làm mịn</span><select tabIndex={-1} value={draft.smoothingType} onChange={(event) => set("smoothingType", event.target.value as MaType)}><option>SMA</option><option>EMA</option><option>WMA</option></select></label>
          <label className="volume-dialog__row"><span>Chiều dài làm mịn</span><input type="number" tabIndex={-1} min="1" max="10000" value={draft.smoothingLength} onChange={(event) => set("smoothingLength", Math.max(1, Math.min(10000, Number(event.target.value) || 1)))}/></label>
        </>}
        {tab === "style" && <>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.histogramVisible} onChange={(event) => set("histogramVisible", event.target.checked)}/>Khối lượng</label>
          <div className="volume-dialog__row volume-dialog__row--indent"><span>Giảm giá</span><ChartColorPicker label="Màu giảm giá" value={draft.downColor} onChange={(value) => set("downColor", value)} preview="line"/></div>
          <div className="volume-dialog__row volume-dialog__row--indent"><span>Tăng trưởng</span><ChartColorPicker label="Màu tăng trưởng" value={draft.upColor} onChange={(value) => set("upColor", value)} preview="line"/></div>
          <div className="volume-dialog__check volume-dialog__plot-row"><label><input type="checkbox" tabIndex={-1} checked={draft.maVisible} onChange={(event) => set("maVisible", event.target.checked)}/>Volume MA</label><ChartColorPicker label="Màu Volume MA" value={draft.maColor} onChange={(value) => set("maColor", value)} preview="line"/><PlotStylePicker value={draft.maPlotStyle} onChange={(value) => set("maPlotStyle", value)} priceLineVisible={draft.maPriceLineVisible} onPriceLineChange={(value) => set("maPriceLineVisible", value)}/></div>
          <div className="volume-dialog__check volume-dialog__plot-row"><label><input type="checkbox" tabIndex={-1} checked={draft.smoothedVisible} onChange={(event) => set("smoothedVisible", event.target.checked)}/>Smoothed MA</label><ChartColorPicker label="Màu Smoothed MA" value={draft.smoothedColor} onChange={(value) => set("smoothedColor", value)} preview="line"/><PlotStylePicker value={draft.smoothedPlotStyle} onChange={(value) => set("smoothedPlotStyle", value)} priceLineVisible={draft.smoothedPriceLineVisible} onPriceLineChange={(value) => set("smoothedPriceLineVisible", value)}/></div>
          <h3>ĐẦU RA</h3>
          <label className="volume-dialog__row"><span>Độ chính xác</span><select tabIndex={-1} defaultValue="default"><option value="default">Mặc định</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.scaleLabelVisible} onChange={(event) => set("scaleLabelVisible", event.target.checked)}/>Nhãn trên thang giá</label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.statusValueVisible} onChange={(event) => set("statusValueVisible", event.target.checked)}/>Giá trị trong dòng trạng thái</label>
        </>}
        {tab === "visibility" && intervals.map(([label, min, max], index) =>
          <label className="volume-dialog__row volume-dialog__interval" key={label}><span><input type="checkbox" tabIndex={-1} checked={draft.visibleIntervals[index]} onChange={(event) => set("visibleIntervals", draft.visibleIntervals.map((value, item) => item === index ? event.target.checked : value))}/>{label}</span><input type="number" tabIndex={-1} defaultValue={min} min="1"/><span className="volume-dialog__range"/><input type="number" tabIndex={-1} defaultValue={max} min="1"/></label>)}
      </div>
      <footer><span/><button type="button" tabIndex={-1} onClick={onClose}>Hủy bỏ</button><button type="button" tabIndex={-1} className="volume-dialog__ok" onClick={() => { onApply(draft); onClose(); }}>Ok</button></footer>
    </section>
  </div>;
}
