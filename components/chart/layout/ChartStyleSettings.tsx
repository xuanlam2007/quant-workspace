"use client";

import { CHART_STYLES, PRICE_SOURCES, candleStyle, singleValueStyle, type ChartStyle, type ChartStyleSettings as Settings } from "../config/chart-styles";
import { ChartColorPicker } from "./ChartColorPicker";

export function ChartStyleSettings({ style, value, onChange }: { style: ChartStyle; value: Settings; onChange: (value: Settings) => void }) {
  const update = <K extends keyof Settings>(key: K, next: Settings[K]) => onChange({ ...value, [key]: next });
  const check = (key: keyof Settings, label: string) => <label className="chart-settings__check"><input type="checkbox" tabIndex={-1} checked={Boolean(value[key])} onChange={(event) => update(key, event.target.checked as never)}/><span>{label}</span></label>;
  const color = (key: keyof Settings, label: string) => <div className="chart-settings__row"><span>{label}</span><ChartColorPicker label={label} value={String(value[key])} onChange={(next) => update(key, next as never)}/></div>;
  const colors = (up: keyof Settings, down: keyof Settings, label: string) => <div className="chart-settings__row"><span>{label}</span><div className="chart-style-settings__colors"><ChartColorPicker label={`${label}: tăng`} value={String(value[up])} onChange={(next) => update(up, next as never)}/><ChartColorPicker label={`${label}: giảm`} value={String(value[down])} onChange={(next) => update(down, next as never)}/></div></div>;
  const line = (colorKey: keyof Settings, widthKey: keyof Settings, styleKey: keyof Settings | null, label: string) => <div className="chart-settings__row"><span>{label}</span><div className="chart-style-settings__line"><ChartColorPicker label={label} value={String(value[colorKey])} onChange={(next) => update(colorKey, next as never)}/><select tabIndex={-1} aria-label={`${label}: độ dày`} value={Number(value[widthKey])} onChange={(event) => update(widthKey, Number(event.target.value) as never)}>{[1, 2, 3, 4].map((width) => <option key={width} value={width}>{width}px</option>)}</select>{styleKey && <select tabIndex={-1} aria-label={`${label}: kiểu đường`} value={Number(value[styleKey])} onChange={(event) => update(styleKey, Number(event.target.value) as never)}><option value={0}>Liền</option><option value={1}>Chấm</option><option value={2}>Gạch</option></select>}</div></div>;

  return <>
    <h3>{CHART_STYLES.find((item) => item.id === style)!.label.toLocaleUpperCase("vi")}</h3>
    {singleValueStyle(style) && <label className="chart-settings__row"><span>Nguồn</span><select tabIndex={-1} value={value.source} onChange={(event) => update("source", event.target.value as Settings["source"])}>{PRICE_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>}
    {(candleStyle(style) || style === 0 || style === 13) && <>
      {style !== 9 && check("previousClose", "Các thanh màu dựa trên đóng cửa phiên trước")}
      {candleStyle(style) && check("bodyVisible", "Thân")}
      {colors("upColor", "downColor", candleStyle(style) ? "Thân" : "Màu thanh")}
      {candleStyle(style) && <>{check("borderVisible", "Đường viền")}{colors("borderUpColor", "borderDownColor", "Đường viền")}{check("wickVisible", "Bóng nến")}{colors("wickUpColor", "wickDownColor", "Bóng nến")}</>}
      {style === 0 && <>{check("thinBars", "Thanh mảnh")}{check("openVisible", "Giá mở cửa")}</>}
      {style === 8 && check("realPriceVisible", "Hiển thị giá thực cuối cùng")}
    </>}
    {[2, 14, 15, 3].includes(style) && line("color", "lineWidth", "lineStyle", "Đường")}
    {style === 3 && <>{color("fillTop", "Màu phía trên")}{color("fillBottom", "Màu phía dưới")}</>}
    {(style === 16 || style === 10) && <>
      {line("highColor", "highWidth", style === 16 ? "highStyle" : null, style === 16 ? "Giá cao" : "Đường phía trên")}
      {line("lowColor", "lowWidth", style === 16 ? "lowStyle" : null, style === 16 ? "Giá thấp" : "Đường phía dưới")}
      {style === 16 && line("color", "lineWidth", "lineStyle", "Giá đóng cửa")}
      {color("highFill", style === 16 ? "Vùng cao tới đóng cửa" : "Vùng phía trên 1")}
      {style === 10 && color("topFill2", "Vùng phía trên 2")}
      {color("lowFill", style === 16 ? "Vùng đóng cửa tới thấp" : "Vùng phía dưới 1")}
      {style === 10 && <>{color("bottomFill2", "Vùng phía dưới 2")}{color("baselineColor", "Đường cơ sở")}<label className="chart-settings__row"><span>Mức cơ sở</span><input type="number" tabIndex={-1} min={0} max={100} value={Math.round(value.baseLevel * 100) / 100} onChange={(event) => update("baseLevel", Math.max(0, Math.min(100, Number(event.target.value) || 0)))}/><small>%</small></label></>}
    </>}
    {style === 12 && <>{check("bodyVisible", "Thân")}{color("color", "Màu thân")}{check("borderVisible", "Đường viền")}{color("borderUpColor", "Màu đường viền")}{check("labelsVisible", "Nhãn")}{color("labelColor", "Màu nhãn")}</>}
  </>;
}
