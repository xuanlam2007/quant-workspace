"use client";

import { useEffect, useState } from "react";
import type { ScaleMode } from "../config/chart-config";
import { ChartColorPicker } from "./ChartColorPicker";

export interface ChartAppearance {
  upColor: string;
  downColor: string;
  wickVisible: boolean;
  borderVisible: boolean;
  lastPriceVisible: boolean;
  highLowVisible: boolean;
  titleVisible: boolean;
  ohlcVisible: boolean;
  changeVisible: boolean;
  volumeVisible: boolean;
  studyTitleVisible: boolean;
  studyValueVisible: boolean;
  backgroundColor: string;
  gridColor: string;
  gridVisible: boolean;
  crosshairColor: string;
  textColor: string;
  fontSize: number;
  topMargin: number;
  bottomMargin: number;
  rightMargin: number;
}

export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  upColor: "#54BA88", downColor: "#EB4D5C", wickVisible: true, borderVisible: false,
  lastPriceVisible: true, highLowVisible: false, titleVisible: true, ohlcVisible: true,
  changeVisible: true, volumeVisible: false, studyTitleVisible: true, studyValueVisible: true,
  backgroundColor: "#131722", gridColor: "#303948", gridVisible: true,
  crosshairColor: "#758696", textColor: "#8b92a5", fontSize: 12,
  topMargin: 5, bottomMargin: 5, rightMargin: 10,
};

interface ChartSettingsDialogProps {
  open: boolean;
  appearance: ChartAppearance;
  scaleMode: ScaleMode;
  autoScale: boolean;
  inverted: boolean;
  timezone: string;
  axisLabels: { symbol: boolean; seriesValue: boolean; highLow: boolean; studyNames: boolean; studyValues: boolean; align: boolean };
  countdownVisible: boolean;
  onAppearanceChange: (appearance: ChartAppearance) => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  onAutoScaleChange: (value: boolean) => void;
  onInvertChange: (value: boolean) => void;
  onTimezoneChange: (value: string) => void;
  onAxisLabelChange: (key: keyof ChartSettingsDialogProps["axisLabels"], value: boolean) => void;
  onCountdownChange: (value: boolean) => void;
  onClose: () => void;
}

type Tab = "symbol" | "status" | "scales" | "canvas";
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "symbol", label: "Mã", icon: "candles" },
  { id: "status", label: "Dòng trạng thái", icon: "status" },
  { id: "scales", label: "Các tỷ lệ", icon: "scale" },
  { id: "canvas", label: "Canvas", icon: "canvas" },
];

function TabIcon({ name }: { name: string }) {
  if (name === "candles") return <svg viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M17 11v6h3v-6h-3zm-.5-1h4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5zM18 7h1v3.5h-1zm0 10.5h1V21h-1zM9 8v12h3V8H9zm-.5-1h4a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zM10 4h1v3.5h-1zm0 16.5h1V24h-1z"/></svg>;
  if (name === "status") return <svg viewBox="0 0 18 18" width="24" height="24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 3h14M2 7h10M2 11h7M2 15h5"/></svg>;
  if (name === "scale") return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 20V4m0 16h16m-3-4 3 4-3 3M1 7l3-3 3 3"/></svg>;
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 17 12-12 3 3L8 20H5v-3zM14 8l3 3"/></svg>;
}

export function ChartSettingsDialog({ open, appearance, scaleMode, autoScale, inverted, timezone, axisLabels, countdownVisible, onAppearanceChange, onScaleModeChange, onAutoScaleChange, onInvertChange, onTimezoneChange, onAxisLabelChange, onCountdownChange, onClose }: ChartSettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("symbol");
  const [draft, setDraft] = useState(appearance);
  const [initial, setInitial] = useState(appearance);

  useEffect(() => {
    if (!open) return;
    setDraft(appearance);
    setInitial(appearance);
    setTab("symbol");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onClose]);
  if (!open) return null;

  const update = <K extends keyof ChartAppearance>(key: K, value: ChartAppearance[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const check = (key: keyof ChartAppearance, label: string) => <label className="chart-settings__check"><input tabIndex={-1} type="checkbox" checked={Boolean(draft[key])} onChange={(event) => update(key, event.target.checked as never)}/><span>{label}</span></label>;
  const color = (key: keyof ChartAppearance, label: string) => <div className="chart-settings__row"><span>{label}</span><ChartColorPicker label={label} value={String(draft[key])} onChange={(value) => update(key, value as never)}/></div>;
  const number = (key: keyof ChartAppearance, label: string, min: number, max: number, unit = "") => <label className="chart-settings__row"><span>{label}</span><input tabIndex={-1} type="number" min={min} max={max} value={Number(draft[key])} onChange={(event) => update(key, Math.max(min, Math.min(max, Number(event.target.value) || min)) as never)}/><small>{unit}</small></label>;
  const axisCheck = (key: keyof ChartSettingsDialogProps["axisLabels"], label: string) => <label className="chart-settings__check"><input tabIndex={-1} type="checkbox" checked={axisLabels[key]} onChange={(event) => onAxisLabelChange(key, event.target.checked)}/><span>{label}</span></label>;

  return <div className="chart-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="chart-settings" role="dialog" aria-modal="true" aria-labelledby="chart-settings-title">
      <header><h2 id="chart-settings-title">Cài đặt biểu đồ</h2><button type="button" tabIndex={-1} aria-label="Đóng" onClick={onClose}>×</button></header>
      <div className="chart-settings__body">
        <nav aria-label="Nhóm cài đặt">{tabs.map((item) => <button type="button" tabIndex={-1} key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><TabIcon name={item.icon}/>{item.label}</button>)}</nav>
        <div className="chart-settings__content" key={tab}>
          {tab === "symbol" && <>
            <h3>BIỂU ĐỒ NẾN</h3>
            {check("wickVisible", "Bóng nến")}
            {check("borderVisible", "Đường viền")}
            {color("upColor", "Thân nến tăng")}
            {color("downColor", "Thân nến giảm")}
            <h3>ĐƯỜNG GIÁ</h3>
            {check("lastPriceVisible", "Lần cuối")}
            {check("highLowVisible", "Cao và thấp")}
            <h3>ĐIỀU CHỈNH DỮ LIỆU</h3>
            <label className="chart-settings__row"><span>Múi giờ</span><select tabIndex={-1} value={timezone} onChange={(event) => onTimezoneChange(event.target.value)}><option value="Asia/Bangkok">(UTC+7) Bangkok</option><option value="Etc/UTC">(UTC+0) UTC</option><option value="exchange">Múi giờ sàn giao dịch</option></select></label>
          </>}
          {tab === "status" && <>
            <h3>MÃ</h3>
            {check("titleVisible", "Tiêu đề")}
            {check("ohlcVisible", "Giá trị OHLC")}
            {check("changeVisible", "Các giá trị thay đổi thanh")}
            {check("volumeVisible", "Khối lượng")}
            <h3>CÁC CHỈ BÁO</h3>
            {check("studyTitleVisible", "Tiêu đề")}
            {check("studyValueVisible", "Giá trị")}
          </>}
          {tab === "scales" && <>
            <h3>NHÃN TRÊN THANG GIÁ</h3>
            {axisCheck("symbol", "Tên Mã giao dịch")}
            {axisCheck("seriesValue", "Giá cuối cùng của mã")}
            {axisCheck("highLow", "Giá cao và thấp")}
            {axisCheck("studyNames", "Tên chỉ báo")}
            {axisCheck("studyValues", "Giá trị Chỉ báo")}
            {axisCheck("align", "Không chồng lấn")}
            <h3>THANG GIÁ</h3>
            <label className="chart-settings__row"><span>Chế độ thang (A và L)</span><select tabIndex={-1} value={scaleMode} onChange={(event) => onScaleModeChange(event.target.value as ScaleMode)}><option value="normal">Đều đặn</option><option value="percent">Phần trăm</option><option value="indexed">Lập chỉ mục tới 100</option><option value="log">Logarit</option></select></label>
            <label className="chart-settings__check"><input tabIndex={-1} type="checkbox" checked={autoScale} onChange={(event) => onAutoScaleChange(event.target.checked)}/><span>Tự động khớp dữ liệu</span></label>
            <label className="chart-settings__check"><input tabIndex={-1} type="checkbox" checked={inverted} onChange={(event) => onInvertChange(event.target.checked)}/><span>Mức Đảo ngược</span></label>
            <label className="chart-settings__check"><input tabIndex={-1} type="checkbox" checked={countdownVisible} onChange={(event) => onCountdownChange(event.target.checked)}/><span>Đếm ngược tới khi Đóng Thanh</span></label>
          </>}
          {tab === "canvas" && <>
            <h3>KIỂU CƠ BẢN CỦA BIỂU ĐỒ</h3>
            {color("backgroundColor", "Hình nền")}
            {check("gridVisible", "Đường lưới")}
            {color("gridColor", "Màu đường lưới")}
            {color("crosshairColor", "Đường chữ thập")}
            <h3>CÁC TỶ LỆ</h3>
            {color("textColor", "Văn bản")}
            {number("fontSize", "Cỡ chữ", 10, 24)}
            <h3>KÝ QUỸ</h3>
            {number("topMargin", "Trên đầu", 0, 40, "%")}
            {number("bottomMargin", "Đáy", 0, 40, "%")}
            {number("rightMargin", "Phải", 0, 50, "thanh")}
          </>}
        </div>
      </div>
      <footer><span/><button type="button" tabIndex={-1} className="chart-settings__cancel" onClick={() => { onAppearanceChange(initial); onClose(); }}>Hủy bỏ</button><button type="button" tabIndex={-1} className="chart-settings__ok" onClick={() => { onAppearanceChange(draft); onClose(); }}>Ok</button></footer>
    </section>
  </div>;
}
