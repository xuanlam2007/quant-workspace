import type { CalloutToolOptions, TextFontOptions } from "lightweight-charts-line-tools-core";
import { VNDIRECT_CHART_FONT } from "./drawing-presets";

export const NOTE_INTERVALS = [
  ["minutes", "Sóng nhỏ", 59],
  ["hours", "Giờ", 24],
  ["days", "Ngày", 366],
  ["weeks", "Tuần", 52],
  ["months", "Tháng", 12],
] as const;
export type NoteInterval = typeof NOTE_INTERVALS[number][0];
export interface NoteIntervalRange { enabled: boolean; from: number; to: number }
export interface PriceNoteSettings {
  title: string;
  showLabel: boolean;
  value: string;
  font: TextFontOptions;
  horizontal: "left" | "center" | "right";
  vertical: "top" | "middle" | "bottom";
  intervals: Record<NoteInterval, NoteIntervalRange>;
}
export type PriceNoteOptions = CalloutToolOptions & { priceNote?: PriceNoteSettings };

export function priceNoteSettings(options: PriceNoteOptions): PriceNoteSettings {
  const saved = options.priceNote;
  return {
    title: "Ghi chú Giá",
    showLabel: false,
    value: "",
    horizontal: "center",
    vertical: "top",
    ...saved,
    font: { color: "#2962ff", size: 14, bold: false, italic: false, family: VNDIRECT_CHART_FONT, ...saved?.font },
    intervals: Object.fromEntries(NOTE_INTERVALS.map(([id, , maximum]) => [id, { enabled: true, from: 1, to: maximum, ...saved?.intervals?.[id] }])) as Record<NoteInterval, NoteIntervalRange>,
  };
}

export function priceNoteVisible(options: PriceNoteOptions, resolution: string) {
  const suffix = resolution.slice(-1);
  const count = Number.parseInt(resolution, 10) || 1;
  const group: NoteInterval = suffix === "D" ? "days" : suffix === "W" ? "weeks" : suffix === "M" ? "months" : count >= 60 ? "hours" : "minutes";
  const multiplier = group === "hours" ? count / 60 : count;
  const range = priceNoteSettings(options).intervals[group];
  return options.visible !== false && range.enabled && multiplier >= range.from && multiplier <= range.to;
}
