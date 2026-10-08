"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { COMPARISON_INTERVALS, COMPARISON_PLOTS, COMPARISON_SOURCES, comparisonDefaults, normalizeComparisonSettings, type ComparisonSettings } from "../../config/comparison-settings";
import { readSaved, writeSaved } from "../../config/saved-state";
import { useDraggablePanel } from "../../ui/useDraggablePanel";
import { PANE_CONTROL_ICONS } from "../panes/pane-control-icons";
import { ChartColorPicker } from "./ChartColorPicker";

export function ComparisonSettingsDialog({ title, settings, onApply, onClose }: {
  title: string; settings: ComparisonSettings; onApply: (settings: ComparisonSettings) => void; onClose: () => void;
}) {
  const initial = useRef(structuredClone(settings));
  const current = useRef({ onApply, onClose });
  current.current = { onApply, onClose };
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<"style" | "visibility">("style");
  const drag = useDraggablePanel(true);
  const cancel = () => { current.current.onApply(initial.current); current.current.onClose(); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") event.preventDefault();
      if (event.key === "Escape" && !event.defaultPrevented) { current.current.onApply(initial.current); current.current.onClose(); }
    };
    const previousFocus = document.activeElement;
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const change = (next: ComparisonSettings) => { setDraft(next); onApply(next); };
  const patch = (next: Partial<ComparisonSettings>) => change({ ...draft, ...next });
  const interval = (index: number, key: "enabled" | "from" | "to", value: boolean | number) => {
    const ranges = draft.intervals.map(item => ({ ...item }));
    const item = ranges[index];
    if (key === "enabled") item.enabled = Boolean(value);
    else {
      const number = Math.max(1, Math.min(COMPARISON_INTERVALS[index][1], Math.round(Number(value)) || 1));
      item[key] = key === "from" ? Math.min(number, item.to) : Math.max(number, item.from);
    }
    patch({ intervals: ranges });
  };
  return <div className="volume-dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) cancel(); }}>
    <section className={`volume-dialog comparison-dialog comparison-dialog--${tab}`} style={drag.style} role="dialog" aria-modal="true" aria-label={`Cài đặt ${title}`}>
      <header {...drag.handle}><h2>{title}</h2><button type="button" tabIndex={-1} aria-label="Đóng" onClick={cancel} dangerouslySetInnerHTML={{ __html: PANE_CONTROL_ICONS.close }} /></header>
      <nav aria-label="Cài đặt mã so sánh">{[["style", "Định dạng"], ["visibility", "Hiển thị"]].map(([id, label]) => <button type="button" tabIndex={-1} key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</nav>
      <div className="volume-dialog__content">
        {tab === "style" ? <>
          <label className="volume-dialog__row"><span>Định dạng</span><select tabIndex={-1} value={draft.plot} onChange={event => patch({ plot: Number(event.target.value) })}>{COMPARISON_PLOTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="volume-dialog__row"><span>Nguồn giá</span><select tabIndex={-1} value={draft.source} onChange={event => patch({ source: event.target.value as ComparisonSettings["source"] })}>{COMPARISON_SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="volume-dialog__row comparison-dialog__line"><span>Đường thẳng</span><ChartColorPicker label="Màu đường so sánh" value={draft.color} onChange={color => patch({ color })} preview="line" /><select tabIndex={-1} aria-label="Độ dày đường" value={draft.width} onChange={event => patch({ width: Number(event.target.value) })}>{[1, 2, 3, 4].map(width => <option key={width} value={width}>{width}px</option>)}</select></div>
          <label className="volume-dialog__row"><span>Kiểu đường</span><select tabIndex={-1} value={draft.lineStyle} onChange={event => patch({ lineStyle: Number(event.target.value) })}>{["Liền", "Chấm", "Gạch", "Gạch chấm", "Chấm thưa"].map((label, index) => <option key={index} value={index}>{label}</option>)}</select></label>
          <label className="volume-dialog__check"><input type="checkbox" tabIndex={-1} checked={draft.priceLine} onChange={event => patch({ priceLine: event.target.checked })} />Đường Giá</label>
          <label className="volume-dialog__row"><span>Ghi đè min tick</span><select tabIndex={-1} value={draft.minTick ?? "default"} onChange={event => patch({ minTick: event.target.value === "default" ? null : Number(event.target.value) })}><option value="default">Mặc định</option>{[.00000001, .0000001, .000001, .00001, .0001, .001, .01, .05, .1, .25, .5, 1, 5, 10, 100].map(tick => <option key={tick} value={tick}>{tick.toLocaleString("en-US", { maximumFractionDigits: 8 })}</option>)}</select></label>
        </> : COMPARISON_INTERVALS.map(([label, maximum], index) => {
          const item = draft.intervals[index];
          return <div className="comparison-dialog__interval" key={label}>
            <label><input type="checkbox" tabIndex={-1} checked={item.enabled} onChange={event => interval(index, "enabled", event.target.checked)} />{label}</label>
            <input type="number" tabIndex={-1} aria-label={`${label}: từ`} min={1} max={item.to} disabled={!item.enabled} value={item.from} onChange={event => interval(index, "from", Number(event.target.value))} />
            <div className="comparison-dialog__range" style={{ "--range-from": `${(item.from - 1) / (maximum - 1) * 100}%`, "--range-to": `${(item.to - 1) / (maximum - 1) * 100}%` } as CSSProperties} data-disabled={!item.enabled}>
              <input type="range" tabIndex={-1} aria-label={`${label}: kéo mức tối thiểu`} min={1} max={maximum} disabled={!item.enabled} value={item.from} onChange={event => interval(index, "from", Number(event.target.value))} />
              <input type="range" tabIndex={-1} aria-label={`${label}: kéo mức tối đa`} min={1} max={maximum} disabled={!item.enabled} value={item.to} onChange={event => interval(index, "to", Number(event.target.value))} />
            </div>
            <input type="number" tabIndex={-1} aria-label={`${label}: đến`} min={item.from} max={maximum} disabled={!item.enabled} value={item.to} onChange={event => interval(index, "to", Number(event.target.value))} />
          </div>;
        })}
      </div>
      <footer><select tabIndex={-1} aria-label="Các mặc định" value="" onChange={event => {
        if (event.target.value === "save") writeSaved("chart.comparisonDefaults.v1", draft);
        if (event.target.value === "reset") change(comparisonDefaults(initial.current.color));
        if (event.target.value === "load") change(normalizeComparisonSettings(readSaved("chart.comparisonDefaults.v1"), initial.current.color));
      }}><option value="" disabled>Các mặc định</option><option value="save">Lưu làm mặc định</option><option value="load">Áp dụng mặc định</option><option value="reset">Khôi phục ban đầu</option></select><span /><button type="button" tabIndex={-1} onClick={cancel}>Hủy bỏ</button><button type="button" tabIndex={-1} className="volume-dialog__ok" onClick={onClose}>Ok</button></footer>
    </section>
  </div>;
}
