import type { Bar } from "@/lib/dchart-api";
import type { MaType } from "../config/chart-config";
import type { MaPoint } from "./chart-indicators";

class Average {
  private inputs: number[] = [];
  private totals: number[] = [];
  private values: number[] = [];
  private length: number;
  private type: MaType;
  constructor(length: number, type: MaType) { this.length = length; this.type = type; }

  at(index: number, input: number): number | undefined {
    this.inputs[index] = input;
    if (index < this.length - 1) return undefined;
    let value: number;
    if (this.type === "WMA") {
      let total = 0;
      for (let i = 0; i < this.length; i++) total += this.inputs[index - this.length + 1 + i] * (i + 1);
      value = total / (this.length * (this.length + 1) / 2);
    } else if (index === this.length - 1) {
      let total = 0;
      for (let i = 0; i < this.length; i++) total += this.inputs[i];
      this.totals[index] = total;
      value = total / this.length;
    } else if (this.type === "EMA") {
      const previous = this.values[index - 1];
      value = (input - previous) * (2 / (this.length + 1)) + previous;
    } else {
      this.totals[index] = this.totals[index - 1] + (input - this.inputs[index - this.length]);
      value = this.totals[index] / this.length;
    }
    this.values[index] = value;
    return value;
  }
}

export class StreamingIndicators {
  private bars: Bar[] = [];
  private averages = new Map<string, Average>();
  private gains: number[] = [];
  private losses: number[] = [];
  private outputs = new Map<string, Map<string, MaPoint>>();
  private cursors = new Map<string, number>();

  reset(bars: Bar[]) {
    this.bars = [...bars];
    this.averages.clear();
    this.gains = [];
    this.losses = [];
    this.outputs.clear();
    this.cursors.clear();
  }

  update(bar: Bar) {
    const last = this.bars.at(-1);
    if (last && Number(bar.time) < Number(last.time)) throw new Error("Dữ liệu chỉ báo phải tăng theo thời gian.");
    this.bars[last?.time === bar.time ? this.bars.length - 1 : this.bars.length] = bar;
  }

  private average(key: string, index: number, value: number, length: number, type: MaType) {
    let average = this.averages.get(key);
    if (!average) { average = new Average(length, type); this.averages.set(key, average); }
    return average.at(index, value);
  }

  private latest(key: string, calculate: (bar: Bar, index: number) => Record<string, number | undefined>) {
    let output = this.outputs.get(key);
    const start = this.cursors.get(key) ?? 0;
    if (!output) { output = new Map(); this.outputs.set(key, output); }
    // Mỗi lần sửa nến hiện tại đều tính từ trạng thái nến trước, không cộng dồn lại.
    for (let index = start; index < this.bars.length; index++) {
      const bar = this.bars[index];
      for (const [name, value] of Object.entries(calculate(bar, index))) {
        if (value !== undefined) output.set(name, { time: bar.time, value });
      }
    }
    this.cursors.set(key, Math.max(0, this.bars.length - 1));
    return output;
  }

  price(length: number, type: MaType) {
    const key = `price:${length}:${type}`;
    return this.latest(key, (bar, i) => ({ value: this.average(key, i, bar.close, length, type) })).get("value");
  }

  volume(length: number, type: MaType, smoothingLength: number) {
    const key = `volume:${length}:${type}:${smoothingLength}`;
    return this.latest(key, (bar, i) => {
      const base = this.average(`${key}:base`, i, bar.volume, length, "SMA");
      return { value: base === undefined || smoothingLength <= 1 ? base
        : this.average(`${key}:smooth`, i - length + 1, base, smoothingLength, type) };
    }).get("value");
  }

  bollinger(length = 20, multiplier = 2) {
    return this.latest(`boll:${length}:${multiplier}`, (_bar, index) => {
      if (index < length - 1) return {};
      const window = this.bars.slice(index - length + 1, index + 1);
      const mean = window.reduce((sum, bar) => sum + bar.close, 0) / length;
      const deviation = Math.sqrt(window.reduce((sum, bar) => sum + (bar.close - mean) ** 2, 0) / length);
      return { upper: mean + multiplier * deviation, middle: mean, lower: mean - multiplier * deviation };
    });
  }

  macd() {
    return this.latest("macd", (bar, i) => {
      const fast = this.average("macd:fast", i, bar.close, 12, "EMA");
      const slow = this.average("macd:slow", i, bar.close, 26, "EMA");
      if (fast === undefined || slow === undefined) return {};
      const macd = fast - slow;
      const signal = this.average("macd:signal", i - 25, macd, 9, "EMA");
      return { macd, signal, histogram: signal === undefined ? undefined : macd - signal };
    });
  }

  rsi() {
    return this.latest("rsi", (_bar, i) => {
      if (i < 14) return {};
      let gain = 0, loss = 0;
      if (i === 14) {
        for (let j = 1; j <= 14; j++) {
          const change = this.bars[j].close - this.bars[j - 1].close;
          gain += Math.max(change, 0); loss += Math.max(-change, 0);
        }
        gain /= 14; loss /= 14;
      } else {
        const change = this.bars[i].close - this.bars[i - 1].close;
        gain = (this.gains[i - 1] * 13 + Math.max(change, 0)) / 14;
        loss = (this.losses[i - 1] * 13 + Math.max(-change, 0)) / 14;
      }
      this.gains[i] = gain; this.losses[i] = loss;
      return { value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) };
    }).get("value");
  }
}
