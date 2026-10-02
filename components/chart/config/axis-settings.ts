import type { ScaleMode } from "./chart-config";

type Side = "left" | "right";
const SETTINGS_KEY = "chart.axisSettings.v1";
// Phiên bản cũ có thể lưu nhầm biên phần trăm dưới chế độ giá tuyệt đối.
const RANGE_KEY = "chart.manualAxisRanges.v2";

export interface AxisSettings {
  mode: ScaleMode;
  side: Side;
  autoScale: boolean;
  inverted: boolean;
  locked: boolean;
  seriesOnly: boolean;
  countdown: boolean;
  labels: { symbol: boolean; seriesValue: boolean; highLow: boolean; studyNames: boolean; studyValues: boolean; align: boolean };
  lines: { price: boolean; highLow: boolean };
  margins: { top: number; bottom: number };
  volumeSide: Side | null;
  indicatorSides: { macd: Side | null; rsi: Side | null };
  sourceSides: Record<string, Side>;
}

const defaults: AxisSettings = {
  mode: "normal", side: "right", autoScale: true, inverted: false, locked: false,
  seriesOnly: false, countdown: false,
  labels: { symbol: true, seriesValue: true, highLow: false, studyNames: false, studyValues: false, align: true },
  lines: { price: true, highLow: false }, margins: { top: 5, bottom: 5 },
  volumeSide: null, indicatorSides: { macd: null, rsi: null }, sourceSides: {},
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function side(value: unknown): Side | null {
  return value === "left" || value === "right" ? value : null;
}

function booleans<T extends Record<string, boolean>>(value: unknown, fallback: T): T {
  const stored = object(value);
  return Object.fromEntries(Object.entries(fallback).map(([key, initial]) => [key, typeof stored[key] === "boolean" ? stored[key] : initial])) as T;
}

export function readAxisSettings(): AxisSettings {
  try {
    const stored = object(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
    const mode = ["normal", "percent", "indexed", "log"].includes(String(stored.mode)) ? stored.mode as ScaleMode : defaults.mode;
    const relative = mode === "percent" || mode === "indexed";
    const flags = booleans(stored, { autoScale: true, inverted: false, locked: false, seriesOnly: false, countdown: false });
    const locked = mode === "normal" && flags.locked;
    const margins = object(stored.margins);
    const validMargins = typeof margins.top === "number" && typeof margins.bottom === "number"
      && margins.top >= 0 && margins.bottom >= 0 && margins.top + margins.bottom < 100;
    const indicatorSides = object(stored.indicatorSides);
    return {
      ...defaults, ...flags, mode, side: side(stored.side) ?? defaults.side,
      autoScale: relative || (!locked && flags.autoScale),
      locked,
      labels: booleans(stored.labels, defaults.labels), lines: booleans(stored.lines, defaults.lines),
      margins: validMargins ? { top: margins.top as number, bottom: margins.bottom as number } : defaults.margins,
      volumeSide: side(stored.volumeSide),
      indicatorSides: { macd: side(indicatorSides.macd), rsi: side(indicatorSides.rsi) },
      sourceSides: Object.fromEntries(Object.entries(object(stored.sourceSides)).flatMap(([key, value]) => side(value) ? [[key, side(value)!]] : [])),
    };
  } catch {
    return defaults;
  }
}

export function writeAxisSettings(settings: AxisSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Trình duyệt có thể chặn bộ nhớ cục bộ. */ }
}

export function readManualAxisRange(symbol: string, resolution: string, mode: ScaleMode): { from: number; to: number } | null {
  try {
    const ranges = object(JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null"));
    const range = object(ranges[`${symbol}:${resolution}:${mode}`]);
    return typeof range.from === "number" && typeof range.to === "number"
      && Number.isFinite(range.from) && Number.isFinite(range.to) && range.from < range.to
      ? { from: range.from, to: range.to } : null;
  } catch { return null; }
}

export function writeManualAxisRange(symbol: string, resolution: string, mode: ScaleMode, range: { from: number; to: number }) {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) return;
  try {
    const ranges = object(JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null"));
    const key = `${symbol}:${resolution}:${mode}`;
    delete ranges[key];
    ranges[key] = range;
    localStorage.setItem(RANGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(ranges).slice(-60))));
  } catch { /* Trình duyệt có thể chặn bộ nhớ cục bộ. */ }
}
