"use client";

import { useEffect, useRef, useState } from "react";
import type { ReferenceDefinition, ReferencePlotStyle, ReferenceSettings } from "@/lib/reference-studies";
import { useDraggablePanel } from "../ui/useDraggablePanel";
import { ChartColorPicker } from "./ChartColorPicker";
import { PANE_CONTROL_ICONS } from "./pane-control-icons";

interface Props {
  definition: ReferenceDefinition;
  settings: ReferenceSettings;
  onApply: (settings: ReferenceSettings) => void;
  onClose: () => void;
}

const plotTypes = [[0, "Đường thẳng"], [7, "Các đường gãy"], [9, "Biểu đồ Đường bậc"], [11, "Đường có bậc và ngắt quãng"], [10, "Bước đường có hình thoi"], [1, "Biểu đồ tần suất"], [3, "Chéo nhau"], [4, "Biểu đồ vùng"], [8, "Vùng gãy"], [5, "Các cột"], [6, "Các vòng tròn"]] as const;

export function ReferenceStudySettingsDialog({ definition, settings, onApply, onClose }: Props) {
  const initial = useRef(structuredClone(settings));
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState("inputs");
  const drag = useDraggablePanel(true);
  const cancel = () => { onApply(initial.current); onClose(); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { onApply(initial.current); onClose(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onApply, onClose]);
  const change = (next: ReferenceSettings) => { setDraft(next); onApply(next); };
  const style = (id: string, patch: Partial<ReferencePlotStyle>) => change({ ...draft, styles: { ...draft.styles, [id]: { ...draft.styles[id], ...patch } } });
  return <div className="volume-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
    <section className="volume-dialog reference-study-dialog" role="dialog" aria-modal="true" aria-label={definition.name} style={drag.style}>
      <header {...drag.handle}>
        <h2>{definition.name}</h2><button type="button" tabIndex={-1} aria-label="Đóng" onClick={cancel} dangerouslySetInnerHTML={{ __html: PANE_CONTROL_ICONS.close }}/>
      </header>
      <nav>{[["inputs", "Các đầu vào"], ["style", "Định dạng"], ["visibility", "Hiển thị"]].map(([id, label]) => <button key={id} type="button" tabIndex={-1} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="volume-dialog__content">
        {tab === "inputs" && definition.metainfo.inputs.filter((input) => !input.isHidden).map((input) => <label className="volume-dialog__row" key={input.id}>
          <span>{input.name}</span>
          {input.type === "bool" ? <input type="checkbox" tabIndex={-1} checked={Boolean(draft.inputs[input.id])} onChange={(event) => change({ ...draft, inputs: { ...draft.inputs, [input.id]: event.target.checked } })}/>
            : input.options ? <select tabIndex={-1} value={String(draft.inputs[input.id])} onChange={(event) => change({ ...draft, inputs: { ...draft.inputs, [input.id]: input.options!.find((value) => String(value) === event.target.value)! } })}>{input.options.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>
              : <input tabIndex={-1} type={["integer", "float"].includes(input.type) ? "number" : "text"} step={input.type === "integer" ? 1 : "any"} min={input.min} max={input.max} value={String(draft.inputs[input.id])} onChange={(event) => { const numeric = ["integer", "float"].includes(input.type); const value = numeric ? Math.max(input.min ?? -Infinity, Math.min(input.max ?? Infinity, Number(event.target.value))) : event.target.value; change({ ...draft, inputs: { ...draft.inputs, [input.id]: value } }); }}/>}</label>)}
        {tab === "style" && <>
          {Object.entries(draft.styles).filter(([id]) => !definition.metainfo.styles?.[id]?.isHidden).map(([id, plot]) => <div key={id} className="reference-study-style">
            <label><input type="checkbox" tabIndex={-1} checked={plot.visible !== false && plot.display !== 0} onChange={(event) => style(id, { visible: event.target.checked, display: event.target.checked ? 15 : 0 })}/>{definition.metainfo.styles?.[id]?.title ?? id}</label>
            <ChartColorPicker label={definition.metainfo.styles?.[id]?.title ?? id} value={plot.color ?? "#2196f3"} onChange={(color) => style(id, { color, transparency: 0 })}/>
            <select tabIndex={-1} aria-label="Kiểu hiển thị" value={String(plot.plottype ?? 0)} onChange={(event) => style(id, { plottype: Number(event.target.value) })}>{plotTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input type="number" tabIndex={-1} aria-label="Độ dày" min={1} max={4} value={plot.linewidth ?? 1} onChange={(event) => style(id, { linewidth: Math.max(1, Math.min(4, Number(event.target.value))) })}/>
            <label><input type="checkbox" tabIndex={-1} checked={plot.trackPrice ?? false} onChange={(event) => style(id, { trackPrice: event.target.checked })}/>Đường Giá</label>
          </div>)}
          {Object.entries(draft.palettes).flatMap(([id, palette]) => Object.entries(palette.colors).map(([key, color]) => <div key={`${id}:${key}`} className="volume-dialog__row"><span>{definition.metainfo.palettes?.[id]?.colors?.[key]?.name ?? `${id} ${key}`}</span><ChartColorPicker label={`${id} ${key}`} value={color.color ?? "#2196f3"} onChange={(next) => change({ ...draft, palettes: { ...draft.palettes, [id]: { ...palette, colors: { ...palette.colors, [key]: { ...color, color: next } } } } })}/></div>))}
          {draft.bands.map((band, index) => <div key={index} className="volume-dialog__row"><label><input type="checkbox" tabIndex={-1} checked={band.visible !== false} onChange={(event) => change({ ...draft, bands: draft.bands.map((value, at) => at === index ? { ...value, visible: event.target.checked } : value) })}/>{definition.metainfo.bands?.[index]?.name ?? index + 1}</label><input type="number" tabIndex={-1} value={band.value} onChange={(event) => change({ ...draft, bands: draft.bands.map((value, at) => at === index ? { ...value, value: Number(event.target.value) } : value) })}/><ChartColorPicker label="Màu mức" value={band.color ?? "#787b86"} onChange={(color) => change({ ...draft, bands: draft.bands.map((value, at) => at === index ? { ...value, color } : value) })}/></div>)}
          {Object.entries(draft.fills).map(([id, fill]) => <div key={id} className="volume-dialog__row"><label><input type="checkbox" tabIndex={-1} checked={fill.visible !== false} onChange={(event) => change({ ...draft, fills: { ...draft.fills, [id]: { ...fill, visible: event.target.checked } } })}/>Hình nền</label><ChartColorPicker label="Màu nền" value={fill.color ?? "#2196f3"} onChange={(color) => change({ ...draft, fills: { ...draft.fills, [id]: { ...fill, color, transparency: 0 } } })}/></div>)}
          <h3>ĐẦU RA</h3>
          <label className="volume-dialog__row"><span>Độ chính xác</span><select tabIndex={-1} value={draft.precision ?? "default"} onChange={(event) => change({ ...draft, precision: event.target.value === "default" ? null : Number(event.target.value) })}><option value="default">Mặc định</option>{Array.from({ length: 9 }, (_, index) => <option key={index}>{index}</option>)}</select></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.scaleLabels} onChange={(event) => change({ ...draft, scaleLabels: event.target.checked })}/>Nhãn trên thang giá</label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.statusValues} onChange={(event) => change({ ...draft, statusValues: event.target.checked })}/>Giá trị trong dòng trạng thái</label>
        </>}
        {tab === "visibility" && draft.intervals.map((interval, index) => <label key={index} className="volume-dialog__row volume-dialog__interval"><span><input type="checkbox" tabIndex={-1} checked={interval.enabled} onChange={(event) => change({ ...draft, intervals: draft.intervals.map((value, at) => at === index ? { ...value, enabled: event.target.checked } : value) })}/>{["Phút", "Giờ", "Ngày", "Tuần", "Tháng"][index]}</span>{(["from", "to"] as const).map((key) => <input key={key} type="number" tabIndex={-1} min={1} value={interval[key]} onChange={(event) => change({ ...draft, intervals: draft.intervals.map((value, at) => at === index ? { ...value, [key]: Math.max(1, Number(event.target.value)) } : value) })}/>)}</label>)}
      </div>
      <footer><span/><button type="button" tabIndex={-1} onClick={cancel}>Hủy bỏ</button><button type="button" tabIndex={-1} className="volume-dialog__ok" onClick={onClose}>Ok</button></footer>
    </section>
  </div>;
}
