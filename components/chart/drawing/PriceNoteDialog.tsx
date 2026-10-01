"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { interpolateLogicalIndexFromTime, interpolateTimeFromLogicalIndex, type LineToolExport, type TextFontOptions } from "lightweight-charts-line-tools-core";
import { ChartColorPicker } from "../layout/ChartColorPicker";
import { PANE_CONTROL_ICONS } from "../layout/pane-control-icons";
import { useDraggablePanel } from "../ui/useDraggablePanel";
import { NOTE_INTERVALS, priceNoteSettings, type NoteInterval, type NoteIntervalRange, type PriceNoteOptions, type PriceNoteSettings } from "./price-note-options";
import { VNDIRECT_TOOLBAR_ICONS } from "./vndirect-icons";

interface Props {
  drawing: LineToolExport<"PriceNote">;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  onPreview: (drawing: LineToolExport<"PriceNote">) => void;
  onCancel: () => void;
  onConfirm: (drawing: LineToolExport<"PriceNote">) => void;
}
const tabs = [["style", "Định dạng"], ["text", "Văn bản"], ["coordinates", "Tọa độ"], ["visibility", "Hiển thị"]] as const;
const templateKey = "vndirect-price-note-templates";
const sizes = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40];

function FontControls({ font, disabled = false, onChange }: { font: TextFontOptions; disabled?: boolean; onChange: (font: TextFontOptions) => void }) {
  return <div className="price-note-font">
    <ChartColorPicker label="Màu văn bản" value={font.color} disabled={disabled} onChange={(color) => onChange({ ...font, color })}/>
    <select tabIndex={-1} aria-label="Cỡ chữ" value={font.size} disabled={disabled} onChange={(event) => onChange({ ...font, size: Number(event.target.value) })}>
      {Array.from(new Set([...sizes, font.size])).sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
    </select>
    <button type="button" tabIndex={-1} className={font.bold ? "is-active" : ""} disabled={disabled} aria-label="Chữ đậm" aria-pressed={font.bold} onClick={() => onChange({ ...font, bold: !font.bold })}><strong>B</strong></button>
    <button type="button" tabIndex={-1} className={font.italic ? "is-active" : ""} disabled={disabled} aria-label="Chữ nghiêng" aria-pressed={font.italic} onClick={() => onChange({ ...font, italic: !font.italic })}><em>I</em></button>
  </div>;
}

export function PriceNoteDialog({ drawing, chart, series, onPreview, onCancel, onConfirm }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(drawing));
  const [tab, setTab] = useState<typeof tabs[number][0]>("style");
  const [renaming, setRenaming] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [templates, setTemplates] = useState<Record<string, PriceNoteOptions>>({});
  const drag = useDraggablePanel(true);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancelRef.current(); };
    document.addEventListener("keydown", escape);
    try {
      const saved = JSON.parse(localStorage.getItem(templateKey) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setTemplates(saved);
    } catch {}
    return () => document.removeEventListener("keydown", escape);
  }, []);
  const note = priceNoteSettings(draft.options);
  const apply = (next: typeof draft) => { setDraft(next); onPreview(next); };
  const options = (next: PriceNoteOptions) => apply({ ...draft, options: { ...next, showPriceAxisLabels: true, showTimeAxisLabels: true } });
  const changeNote = (patch: Partial<PriceNoteSettings>) => options({ ...draft.options, priceNote: { ...note, ...patch } });
  const labelColor = (part: "background" | "border", color: string) => {
    const box = draft.options.text.box;
    const nextBox = part === "background"
      ? { ...box, background: { inflation: { x: 0, y: 0 }, ...box.background, color } }
      : { ...box, border: { width: 1, radius: 4, highlight: false, style: LineStyle.Solid, ...box.border, color } };
    options({ ...draft.options, text: { ...draft.options.text, box: nextBox } });
  };
  const interval = (id: NoteInterval, patch: Partial<NoteIntervalRange>, maximum: number) => {
    const current = note.intervals[id];
    const next = { ...current, ...patch };
    next.from = Math.max(1, Math.min(maximum, next.from));
    next.to = Math.max(next.from, Math.min(maximum, next.to));
    changeNote({ intervals: { ...note.intervals, [id]: next } });
  };
  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const next = { ...templates, [name]: structuredClone(draft.options) };
    try { localStorage.setItem(templateKey, JSON.stringify(next)); setTemplates(next); setSavingTemplate(false); setTemplateError(""); }
    catch { setTemplateError("Không thể lưu bản mẫu trên trình duyệt này."); }
  };

  return <div className="drawing-dialog-backdrop" role="presentation">
    <section className={`text-tool-dialog price-note-dialog${tab === "visibility" ? " price-note-dialog--visibility" : ""}`} role="dialog" aria-modal="true" aria-labelledby="price-note-title" style={drag.style} onKeyDownCapture={(event) => { if (event.key === "Tab") event.preventDefault(); }}>
      <header className="text-tool-header" {...drag.handle}>
        <h2 id="price-note-title" className="text-tool-title">{renaming
          ? <input tabIndex={-1} aria-label="Tên bản vẽ" autoFocus value={note.title} maxLength={64} onChange={(event) => changeNote({ title: event.target.value })} onBlur={() => setRenaming(false)} onKeyDown={(event) => { if (event.key === "Enter") setRenaming(false); }}/>
          : note.title || "Ghi chú Giá"}
          <button type="button" tabIndex={-1} className="price-note-rename" aria-label="Đổi tên bản vẽ" onClick={() => setRenaming(true)} dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS.propertyLineColor }}/>
        </h2>
        <button type="button" tabIndex={-1} className="text-tool-close-btn" aria-label="Đóng" onClick={onCancel} dangerouslySetInnerHTML={{ __html: PANE_CONTROL_ICONS.close }}/>
      </header>
      <nav className="text-tool-tabs" role="tablist" aria-label="Cài đặt ghi chú giá">{tabs.map(([id, label]) => <button type="button" tabIndex={-1} key={id} role="tab" aria-selected={tab === id} className={`text-tool-tab${tab === id ? " is-active" : ""}`} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="price-note-dialog__body" role="tabpanel" aria-label={tabs.find(([id]) => id === tab)?.[1]}>
        {tab === "style" && <>
          <div className="price-note-row"><span>Nhãn Văn bản</span><FontControls font={draft.options.text.font} onChange={(font) => options({ ...draft.options, text: { ...draft.options.text, font } })}/></div>
          <div className="price-note-row"><span>Hình nền của nhãn</span><ChartColorPicker label="Hình nền của nhãn" value={draft.options.text.box.background?.color ?? "#2962ff"} onChange={(color) => labelColor("background", color)}/></div>
          <div className="price-note-row"><span>Đường viền nhãn</span><ChartColorPicker label="Đường viền nhãn" value={draft.options.text.box.border?.color ?? "#2962ff"} onChange={(color) => labelColor("border", color)}/></div>
          <div className="price-note-row"><span>Màu đường kẻ</span><ChartColorPicker label="Màu đường kẻ" value={draft.options.line.color} onChange={(color) => options({ ...draft.options, line: { ...draft.options.line, color } })}/></div>
        </>}
        {tab === "text" && <>
          <div className="price-note-row price-note-row--text"><label><input type="checkbox" tabIndex={-1} checked={note.showLabel} onChange={(event) => changeNote({ showLabel: event.target.checked })}/>Văn bản</label><FontControls font={note.font} disabled={!note.showLabel} onChange={(font) => changeNote({ font })}/></div>
          <textarea tabIndex={-1} aria-label="Nội dung ghi chú" disabled={!note.showLabel} value={note.value} onChange={(event) => changeNote({ value: event.target.value })}/>
          <div className="price-note-row price-note-row--text"><span>Căn chỉnh chữ</span><div className="price-note-alignment">
            <select tabIndex={-1} aria-label="Căn chỉnh dọc" disabled={!note.showLabel} value={note.vertical} onChange={(event) => changeNote({ vertical: event.target.value as PriceNoteSettings["vertical"] })}><option value="top">Đỉnh</option><option value="middle">Giữa</option><option value="bottom">Đáy</option></select>
            <select tabIndex={-1} aria-label="Căn chỉnh ngang" disabled={!note.showLabel} value={note.horizontal} onChange={(event) => changeNote({ horizontal: event.target.value as PriceNoteSettings["horizontal"] })}><option value="left">Trái</option><option value="center">Trung tâm</option><option value="right">Phải</option></select>
          </div></div>
        </>}
        {tab === "coordinates" && draft.points.map((point, index) => {
          const logical = interpolateLogicalIndexFromTime(chart, series, point.timestamp as Time);
          const barIndex = logical === null ? "" : Math.round(logical);
          return <div className="price-note-row price-note-coordinates" key={index}><span>#{index + 1} (giá, thanh)</span>
            <input tabIndex={-1} type="number" step="any" aria-label={`Giá điểm ${index + 1}`} value={point.price} onChange={(event) => { const price = event.target.valueAsNumber; if (Number.isFinite(price)) apply({ ...draft, points: draft.points.map((item, i) => i === index ? { ...item, price } : item) }); }}/>
            <input tabIndex={-1} type="number" step="1" aria-label={`Thanh điểm ${index + 1}`} value={barIndex} disabled={logical === null} onChange={(event) => {
              const bar = event.target.valueAsNumber;
              if (!Number.isSafeInteger(bar)) return;
              const timestamp = interpolateTimeFromLogicalIndex(chart, series, bar);
              if (typeof timestamp === "number" && Number.isFinite(timestamp)) apply({ ...draft, points: draft.points.map((item, i) => i === index ? { ...item, timestamp } : item) });
            }}/>
          </div>;
        })}
        {tab === "visibility" && NOTE_INTERVALS.map(([id, label, maximum]) => {
          const range = note.intervals[id];
          return <div className="price-note-interval" key={id}>
            <label><input type="checkbox" tabIndex={-1} checked={range.enabled} onChange={(event) => interval(id, { enabled: event.target.checked }, maximum)}/>{label}</label>
            <input type="number" tabIndex={-1} min="1" max={range.to} disabled={!range.enabled} aria-label={`${label}: từ`} value={range.from} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) interval(id, { from: Math.min(range.to, event.target.valueAsNumber) }, maximum); }}/>
            <div className="price-note-range" style={{ "--range-from": `${(range.from - 1) / (maximum - 1) * 100}%`, "--range-to": `${(range.to - 1) / (maximum - 1) * 100}%` } as CSSProperties}>
              <input type="range" tabIndex={-1} min="1" max={maximum} disabled={!range.enabled} aria-label={`${label}: mức thấp`} value={range.from} onChange={(event) => interval(id, { from: Math.min(range.to, Number(event.target.value)) }, maximum)}/>
              <input type="range" tabIndex={-1} min="1" max={maximum} disabled={!range.enabled} aria-label={`${label}: mức cao`} value={range.to} onChange={(event) => interval(id, { to: Math.max(range.from, Number(event.target.value)) }, maximum)}/>
            </div>
            <input type="number" tabIndex={-1} min={range.from} max={maximum} disabled={!range.enabled} aria-label={`${label}: đến`} value={range.to} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) interval(id, { to: event.target.valueAsNumber }, maximum); }}/>
          </div>;
        })}
      </div>
      <footer className="text-tool-footer">
        <div className="price-note-template"><select tabIndex={-1} aria-label="Bản mẫu" value="" onChange={(event) => { const name = event.target.value; if (name === "__save") { setTemplateName(""); setSavingTemplate(true); } else if (templates[name]?.text && templates[name]?.line) options(structuredClone(templates[name])); }}>
          <option value="" disabled>Bản mẫu</option><option value="__save">Lưu bản mẫu...</option>{Object.keys(templates).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>{savingTemplate && <div className="price-note-template__save"><input tabIndex={-1} aria-label="Tên bản mẫu" value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={64}/><button type="button" tabIndex={-1} onClick={saveTemplate} disabled={!templateName.trim()}>Lưu</button><button type="button" tabIndex={-1} onClick={() => setSavingTemplate(false)}>Hủy bỏ</button>{templateError && <span role="alert">{templateError}</span>}</div>}</div>
        <div className="text-tool-footer-actions"><button type="button" tabIndex={-1} className="dialog-btn dialog-btn--secondary" onClick={onCancel}>Hủy bỏ</button><button type="button" tabIndex={-1} className="dialog-btn dialog-btn--primary" onClick={() => onConfirm(draft)}>Ok</button></div>
      </footer>
    </section>
  </div>;
}
