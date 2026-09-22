import type { Bar } from "@/lib/dchart-api";
import type { MaType } from "../config/chart-config";

export type MaPoint = { time: Bar["time"]; value: number };

export function calculateMa(points: MaPoint[], length: number, type: MaType): MaPoint[] {
  if (points.length < length) return [];
  if (type === "EMA") {
    const multiplier = 2 / (length + 1);
    let value = points.slice(0, length).reduce((sum, point) => sum + point.value, 0) / length;
    const values = [{ time: points[length - 1].time, value }];
    for (let index = length; index < points.length; index++) {
      value = (points[index].value - value) * multiplier + value;
      values.push({ time: points[index].time, value });
    }
    return values;
  }
  if (type === "WMA") {
    const divisor = (length * (length + 1)) / 2;
    return points.slice(length - 1).map((point, outputIndex) => ({
      time: point.time,
      value: points.slice(outputIndex, outputIndex + length).reduce((sum, item, index) => sum + item.value * (index + 1), 0) / divisor,
    }));
  }
  let total = points.slice(0, length).reduce((sum, point) => sum + point.value, 0);
  const values = [{ time: points[length - 1].time, value: total / length }];
  for (let index = length; index < points.length; index++) {
    total += points[index].value - points[index - length].value;
    values.push({ time: points[index].time, value: total / length });
  }
  return values;
}

export function volumeMa(
  bars: Bar[],
  length: number,
  type: MaType = "SMA",
  smoothingLength = 1,
) {
  const volumePoints = bars.map((bar) => ({ time: bar.time, value: bar.volume }));
  const average = calculateMa(volumePoints, length, type);
  return smoothingLength > 1
    ? calculateMa(average, smoothingLength, "SMA")
    : average;
}

export function priceIndicatorData(bars: Bar[], length: number, type: MaType) {
  return calculateMa(bars.map((bar) => ({ time: bar.time, value: bar.close })), length, type);
}

export function bollingerData(bars: Bar[], band: "upper" | "middle" | "lower", length = 20, multiplier = 2): MaPoint[] {
  if (bars.length < length) return [];
  return bars.slice(length - 1).map((bar, outputIndex) => {
    const window = bars.slice(outputIndex, outputIndex + length);
    const mean = window.reduce((sum, item) => sum + item.close, 0) / length;
    const deviation = Math.sqrt(window.reduce((sum, item) => sum + (item.close - mean) ** 2, 0) / length);
    const value = band === "upper" ? mean + multiplier * deviation : band === "lower" ? mean - multiplier * deviation : mean;
    return { time: bar.time, value };
  });
}

export function macdData(bars: Bar[]) {
  const close = bars.map((bar) => ({ time: bar.time, value: bar.close }));
  const fastByTime = new Map(calculateMa(close, 12, "EMA").map((point) => [Number(point.time), point.value]));
  const macd = calculateMa(close, 26, "EMA").flatMap((point) => {
    const fast = fastByTime.get(Number(point.time));
    return fast === undefined ? [] : [{ time: point.time, value: fast - point.value }];
  });
  const signal = calculateMa(macd, 9, "EMA");
  const signalByTime = new Map(signal.map((point) => [Number(point.time), point.value]));
  const histogram = macd.flatMap((point) => {
    const signalValue = signalByTime.get(Number(point.time));
    if (signalValue === undefined) return [];
    const value = point.value - signalValue;
    return [{ time: point.time, value, color: value >= 0 ? "rgba(83,185,135,.65)" : "rgba(235,77,92,.65)" }];
  });
  return { macd, signal, histogram };
}

export function rsiData(bars: Bar[], length = 14): MaPoint[] {
  if (bars.length <= length) return [];
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= length; index++) {
    const change = bars[index].close - bars[index - 1].close;
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= length;
  averageLoss /= length;
  const values: MaPoint[] = [];
  const append = (index: number) => {
    const value = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    values.push({ time: bars[index].time, value });
  };
  append(length);
  for (let index = length + 1; index < bars.length; index++) {
    const change = bars[index].close - bars[index - 1].close;
    averageGain = (averageGain * (length - 1) + Math.max(change, 0)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(-change, 0)) / length;
    append(index);
  }
  return values;
}
