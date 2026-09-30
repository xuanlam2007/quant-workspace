"use client";

import { useEffect, useState } from "react";
import type { MaType } from "../config/chart-config";

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

export function VolumeSettingsDialog({ settings, onApply, onClose }: Props) {
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
    <section className="volume-dialog" role="dialog" aria-modal="true" aria-label="Volume">
      <header><h2>Volume</h2><button type="button" tabIndex={-1} aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true"><path d="M3 3 21 21M21 3 3 21" stroke="currentColor" strokeWidth="1.5"/></svg></button></header>
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
          <label className="volume-dialog__row volume-dialog__row--indent"><span>Giảm giá</span><input type="color" tabIndex={-1} value={draft.downColor} onChange={(event) => set("downColor", event.target.value)}/></label>
          <label className="volume-dialog__row volume-dialog__row--indent"><span>Tăng trưởng</span><input type="color" tabIndex={-1} value={draft.upColor} onChange={(event) => set("upColor", event.target.value)}/></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.maVisible} onChange={(event) => set("maVisible", event.target.checked)}/>Volume MA <input type="color" tabIndex={-1} value={draft.maColor} onChange={(event) => set("maColor", event.target.value)}/></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.smoothedVisible} onChange={(event) => set("smoothedVisible", event.target.checked)}/>Smoothed MA <input type="color" tabIndex={-1} value={draft.smoothedColor} onChange={(event) => set("smoothedColor", event.target.value)}/></label>
          <h3>ĐẦU RA</h3>
          <label className="volume-dialog__row"><span>Độ chính xác</span><select tabIndex={-1} defaultValue="default"><option value="default">Mặc định</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.scaleLabelVisible} onChange={(event) => set("scaleLabelVisible", event.target.checked)}/>Nhãn trên thang giá</label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.statusValueVisible} onChange={(event) => set("statusValueVisible", event.target.checked)}/>Giá trị trong dòng trạng thái</label>
        </>}
        {tab === "visibility" && intervals.map(([label, min, max], index) =>
          <label className="volume-dialog__row volume-dialog__interval" key={label}><span><input type="checkbox" tabIndex={-1} checked={draft.visibleIntervals[index]} onChange={(event) => set("visibleIntervals", draft.visibleIntervals.map((value, item) => item === index ? event.target.checked : value))}/>{label}</span><input type="number" tabIndex={-1} defaultValue={min} min="1"/><span className="volume-dialog__range"/><input type="number" tabIndex={-1} defaultValue={max} min="1"/></label>)}
      </div>
      <footer><button type="button" tabIndex={-1} className="volume-dialog__template">Các m…⌄</button><span/><button type="button" tabIndex={-1} onClick={onClose}>Hủy bỏ</button><button type="button" tabIndex={-1} className="volume-dialog__ok" onClick={() => { onApply(draft); onClose(); }}>Ok</button></footer>
    </section>
  </div>;
}
