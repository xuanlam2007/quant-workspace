import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { LineStyle, type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesPrimitive, type Logical, type MouseEventParams, type SeriesAttachedParameter, type Time } from "lightweight-charts";
import type { Bar } from "@/lib/dchart-api";
import { defaultStyleSettings, heikinAshi, singleValueStyle, sourceValue, type ChartStyle, type ChartStyleSettings } from "../config/chart-styles";

type Point = { x: number; open: number; high: number; low: number; close: number; bar: Bar; index: number };

// Giữ nguyên nguồn dữ liệu chính để các công cụ vẽ và thang giá không mất liên kết.
export class ChartStyleRenderer implements ISeriesPrimitive<Time> {
  private raw: Bar[] = [];
  private displayed: Bar[] = [];
  private style: ChartStyle = 1;
  private settings = defaultStyleSettings(1);
  private background = "#131722";
  private requestUpdate = () => {};
  private realPriceLine: IPriceLine | null = null;
  private hoveredTime: Time | undefined;
  private dragging: number | null = null;
  private originalBaseLevel = 50;
  private colorFrame = 0;
  private view = { zOrder: () => "normal" as const, renderer: () => this };

  constructor(private chart: IChartApi, private series: ISeriesApi<"Candlestick">, private element: HTMLElement, private onBaseLevelChange: (value: number) => void) {
    series.attachPrimitive(this);
    chart.subscribeCrosshairMove(this.crosshair);
    element.addEventListener("pointerdown", this.pointerDown, true);
    element.addEventListener("pointermove", this.pointerMove, true);
    element.addEventListener("pointerup", this.pointerUp, true);
    element.addEventListener("pointercancel", this.pointerCancel, true);
    window.addEventListener("keydown", this.keyDown, true);
  }

  attached({ requestUpdate }: SeriesAttachedParameter<Time>) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = () => {}; }
  paneViews() { return [this.view]; }
  updateAllViews() {
    if (this.style !== 10 || this.colorFrame) return;
    this.colorFrame = requestAnimationFrame(() => {
      this.colorFrame = 0;
      if (!this.raw.length) return;
      const color = this.color(this.raw.length - 1);
      if (color !== this.series.options().priceLineColor) this.series.applyOptions({ priceLineColor: color });
    });
  }
  private crosshair = (event: MouseEventParams<Time>) => {
    this.hoveredTime = event.paneIndex === this.series.getPane().paneIndex() ? event.time : undefined;
    this.requestUpdate();
  };

  configure(style: ChartStyle, settings: ChartStyleSettings, background: string) {
    if (this.dragging !== null) this.endDrag(false);
    this.style = style;
    this.settings = { ...settings };
    this.background = background;
    this.series.applyOptions({ borderVisible: settings.borderVisible, wickVisible: settings.wickVisible });
    const range = this.chart.timeScale().getVisibleLogicalRange();
    this.setBars(this.raw);
    if (range) this.chart.timeScale().setVisibleLogicalRange(range);
  }

  displayBar(bar: Bar | undefined): Bar | undefined {
    if (!bar || this.style !== 8) return bar;
    let left = 0, right = this.displayed.length - 1;
    while (left <= right) {
      const middle = (left + right) >>> 1;
      const candidate = this.displayed[middle];
      if (candidate.time === bar.time) return candidate;
      if (candidate.time < bar.time) left = middle + 1;
      else right = middle - 1;
    }
    return bar;
  }

  previousClose(time: Time | undefined): number | undefined {
    if (time === undefined) return undefined;
    const index = this.displayed.findIndex((bar) => bar.time === time);
    return index > 0 ? this.displayed[index - 1].close : undefined;
  }

  displayPrice(bar: Bar): number {
    return singleValueStyle(this.style) ? sourceValue(bar, this.settings.source) : this.displayBar(bar)!.close;
  }

  barColor(bar: Bar | undefined): string | undefined {
    if (!bar) return undefined;
    const index = this.displayed.findIndex((value) => value.time === bar.time);
    if (index < 0) return undefined;
    if ([1, 8, 9].includes(this.style)) return this.rising(index) ? this.settings.borderUpColor : this.settings.borderDownColor;
    if (this.style === 12) return this.settings.borderUpColor;
    return this.color(index);
  }

  private transform(bar: Bar, previous?: Bar): Bar {
    if (this.style === 8) return heikinAshi(bar, previous);
    if (singleValueStyle(this.style)) {
      const value = sourceValue(bar, this.settings.source);
      return { ...bar, open: value, high: this.style === 13 ? Math.max(0, value) : value, low: this.style === 13 ? Math.min(0, value) : value, close: value };
    }
    return bar;
  }

  private rising(index: number) {
    const values = this.style === 13 ? this.raw : this.displayed;
    const bar = values[index];
    const previous = values[index - 1];
    if ((this.style === 9 || this.settings.previousClose) && previous) return bar.close >= previous.close;
    const raw = this.raw[index];
    return singleValueStyle(this.style) ? raw.close >= raw.open : bar.close >= bar.open;
  }

  private color(index: number) {
    if ([2, 3, 14, 15, 12, 16].includes(this.style)) return this.settings.color;
    if (this.style === 10) {
      const y = this.series.priceToCoordinate(this.displayed[index].close);
      return y !== null && y > this.series.getPane().getHeight() * (1 - this.settings.baseLevel / 100) ? this.settings.lowColor : this.settings.highColor;
    }
    return this.rising(index) ? this.settings.upColor : this.settings.downColor;
  }

  private candle(index: number): CandlestickData<Time> {
    const bar = this.displayed[index];
    if (this.style !== 1 && this.style !== 8) return { ...bar, color: "transparent", borderColor: "transparent", wickColor: "transparent" };
    const up = this.rising(index), s = this.settings;
    return { ...bar, color: s.bodyVisible ? (up ? s.upColor : s.downColor) : "transparent", borderColor: up ? s.borderUpColor : s.borderDownColor, wickColor: up ? s.wickUpColor : s.wickDownColor };
  }

  setBars(bars: readonly Bar[]) {
    this.raw = [...bars];
    this.displayed = [];
    for (const bar of bars) this.displayed.push(this.transform(bar, this.displayed.at(-1)));
    this.series.setData(this.displayed.map((_, index) => this.candle(index)));
    this.syncLastPrice();
    this.requestUpdate();
  }

  update(bar: Bar) {
    const last = this.raw.at(-1);
    if (last && bar.time < last.time) return;
    const index = last?.time === bar.time ? this.raw.length - 1 : this.raw.length;
    this.raw[index] = bar;
    this.displayed[index] = this.transform(bar, this.displayed[index - 1]);
    this.series.update(this.candle(index));
    this.syncLastPrice();
    this.requestUpdate();
  }

  private syncLastPrice() {
    const last = this.raw.at(-1);
    if (last) this.series.applyOptions({ priceLineColor: this.color(this.raw.length - 1) });
    if (this.style === 8 && this.settings.realPriceVisible && last) {
      const options = { price: last.close, color: this.settings.color, lineWidth: 1 as const, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" };
      if (this.realPriceLine) this.realPriceLine.applyOptions(options);
      else this.realPriceLine = this.series.createPriceLine(options);
    } else if (this.realPriceLine) {
      this.series.removePriceLine(this.realPriceLine);
      this.realPriceLine = null;
    }
  }

  private panePoint(event: PointerEvent) {
    const pane = this.series.getPane();
    const rect = pane.getHTMLElement()?.getBoundingClientRect();
    if (!rect || !this.series.options().visible) return null;
    const left = this.chart.priceScale("left", pane.paneIndex()).width();
    const right = this.chart.priceScale("right", pane.paneIndex()).width();
    if (event.clientX < rect.left + left || event.clientX > rect.right - right) return null;
    return { y: event.clientY - rect.top, height: pane.getHeight() };
  }

  private pointerDown = (event: PointerEvent) => {
    if (this.style !== 10 || event.button !== 0 || !this.raw.length) return;
    const point = this.panePoint(event);
    if (!point || Math.abs(point.y - point.height * (1 - this.settings.baseLevel / 100)) > 5) return;
    this.dragging = event.pointerId;
    this.originalBaseLevel = this.settings.baseLevel;
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.style !== 10) return;
    const point = this.panePoint(event);
    if (this.dragging !== null && this.dragging === event.pointerId) {
      if (point) this.settings.baseLevel = Math.max(0, Math.min(100, 100 * (1 - point.y / point.height)));
      this.syncLastPrice(); this.requestUpdate();
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  private pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.dragging) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.endDrag(true);
  };
  private pointerCancel = (event: PointerEvent) => { if (event.pointerId === this.dragging) this.endDrag(false); };
  private keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.dragging !== null) { event.preventDefault(); event.stopImmediatePropagation(); this.endDrag(false); }
  };
  private endDrag(commit: boolean) {
    const pointer = this.dragging;
    this.dragging = null;
    if (pointer !== null && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
    if (commit) this.onBaseLevelChange(this.settings.baseLevel);
    else this.settings.baseLevel = this.originalBaseLevel;
    this.requestUpdate();
  }

  hitTest(_x: number, y: number) {
    if (this.style === 10 && this.raw.length && this.series.options().visible && Math.abs(y - this.series.getPane().getHeight() * (1 - this.settings.baseLevel / 100)) <= 5) {
      return { externalId: "chart-baseline", cursorStyle: "ns-resize", zOrder: "normal" as const };
    }
    return null;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (this.style === 1 || this.style === 8 || !this.series.options().visible || !this.raw.length) return;
    const scale = this.chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    if (!range) return;
    const first = scale.timeToIndex(this.raw[0].time, true);
    if (first === null) return;
    const visible = scale.getVisibleRange();
    const from = visible ? Number(visible.from) : -Infinity;
    const to = visible ? Number(visible.to) : Infinity;
    let lo = 0, hi = this.displayed.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.displayed[mid].time < from) lo = mid + 1; else hi = mid; }
    const points: Point[] = [];
    for (let index = Math.max(0, lo - 1); index < this.displayed.length; index++) {
      const bar = this.displayed[index];
      const logical = scale.timeToIndex(bar.time, false);
      const x = logical === null ? null : scale.logicalToCoordinate(Number(logical) as Logical);
      const open = this.series.priceToCoordinate(bar.open), high = this.series.priceToCoordinate(bar.high);
      const low = this.series.priceToCoordinate(bar.low), close = this.series.priceToCoordinate(bar.close);
      if (x !== null && open !== null && high !== null && low !== null && close !== null && [x, open, high, low, close].every(Number.isFinite)) points.push({ x, open, high, low, close, bar, index });
      if (bar.time > to) break;
    }
    if (!points.length) return;
    const x0 = scale.logicalToCoordinate(Number(first) as Logical), x1 = scale.logicalToCoordinate((first + 1) as Logical);
    const spacing = x0 !== null && x1 !== null ? Math.abs(x1 - x0) : 6;
    const width = Math.max(1, Math.floor(spacing * 0.8));
    const s = this.settings;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { width: paneWidth, height } = mediaSize;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, paneWidth, height); ctx.clip();
      const stroke = (color: string, lineWidth: number, lineStyle: number, field: "close" | "high" | "low" = "close") => {
        ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineJoin = "round";
        ctx.setLineDash(lineStyle === 1 ? [lineWidth, lineWidth * 2] : lineStyle === 2 ? [lineWidth * 4, lineWidth * 2] : []);
        ctx.beginPath();
        points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point[field]);
          else { if (this.style === 15) ctx.lineTo(point.x, points[index - 1][field]); ctx.lineTo(point.x, point[field]); }
        });
        ctx.stroke(); ctx.setLineDash([]);
      };
      const fill = (top: "close" | "high", bottom: "close" | "low" | number, color: string | CanvasGradient) => {
        ctx.beginPath();
        points.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point[top]); else ctx.lineTo(point.x, point[top]); });
        for (let index = points.length - 1; index >= 0; index--) ctx.lineTo(points[index].x, typeof bottom === "number" ? bottom : points[index][bottom]);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      };
      if ([0, 9, 12, 13].includes(this.style)) {
        for (const point of points) {
          const rising = this.rising(point.index);
          const color = rising ? s.upColor : s.downColor;
          const left = Math.round(point.x - width / 2), center = Math.round(point.x) + 0.5;
          ctx.fillStyle = color; ctx.strokeStyle = color;
          if (this.style === 0) {
            ctx.lineWidth = s.thinBars ? 1 : Math.max(1, Math.floor(spacing * 0.3));
            ctx.beginPath(); ctx.moveTo(center, point.high); ctx.lineTo(center, point.low);
            if (s.openVisible) { ctx.moveTo(center - width / 2, point.open); ctx.lineTo(center, point.open); }
            ctx.moveTo(center, point.close); ctx.lineTo(center + width / 2, point.close); ctx.stroke();
          } else if (this.style === 13) {
            const zero = this.series.priceToCoordinate(0) ?? height;
            ctx.fillRect(left, Math.min(point.close, zero), width, Math.max(1, Math.abs(point.close - zero)));
          } else if (this.style === 12) {
            const top = Math.min(point.high, point.low), size = Math.max(1, Math.abs(point.low - point.high));
            ctx.fillStyle = s.color;
            if (s.bodyVisible) ctx.fillRect(left, top, width, size);
            if (s.borderVisible) { ctx.strokeStyle = s.borderUpColor; ctx.lineWidth = 1; ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, size - 1)); }
            if (s.labelsVisible) {
              ctx.font = "12px Arial"; ctx.textAlign = "center"; ctx.fillStyle = s.labelColor;
              const highText = this.series.priceFormatter().format(point.bar.high), lowText = this.series.priceFormatter().format(point.bar.low);
              if (Math.max(ctx.measureText(highText).width, ctx.measureText(lowText).width) + 4 < spacing) {
                ctx.fillText(highText, point.x, point.high + (point.high < point.low ? -5 : 14));
                ctx.fillText(lowText, point.x, point.low + (point.high < point.low ? 14 : -5));
              }
            }
          } else {
            const top = Math.min(point.open, point.close), bottom = Math.max(point.open, point.close);
            if (s.wickVisible) {
              ctx.strokeStyle = rising ? s.wickUpColor : s.wickDownColor; ctx.lineWidth = 1; ctx.beginPath();
              ctx.moveTo(center, Math.min(point.high, point.low)); ctx.lineTo(center, top); ctx.moveTo(center, bottom); ctx.lineTo(center, Math.max(point.high, point.low)); ctx.stroke();
            }
            if (s.bodyVisible && point.bar.close < point.bar.open) ctx.fillRect(left, top, width, Math.max(1, bottom - top));
            if (s.borderVisible) { ctx.strokeStyle = rising ? s.borderUpColor : s.borderDownColor; ctx.lineWidth = 1; ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, bottom - top - 1)); }
          }
        }
      } else if (this.style === 16) {
        fill("high", "close", s.highFill); fill("close", "low", s.lowFill);
        stroke(s.highColor, s.highWidth, s.highStyle, "high"); stroke(s.lowColor, s.lowWidth, s.lowStyle, "low"); stroke(s.color, s.lineWidth, s.lineStyle);
      } else if (this.style === 10) {
        const base = height * (1 - s.baseLevel / 100);
        for (const above of [true, false]) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, above ? 0 : base, paneWidth, above ? base : height - base); ctx.clip();
          const gradient = ctx.createLinearGradient(0, above ? 0 : base, 0, above ? Math.max(1, base) : height);
          gradient.addColorStop(0, above ? s.highFill : s.bottomFill2); gradient.addColorStop(1, above ? s.topFill2 : s.lowFill);
          fill("close", base, gradient); stroke(above ? s.highColor : s.lowColor, above ? s.highWidth : s.lowWidth, 0); ctx.restore();
        }
        ctx.strokeStyle = s.baselineColor; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(paneWidth, base); ctx.stroke(); ctx.setLineDash([]);
      } else {
        if (this.style === 3) {
          const gradient = ctx.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, s.fillTop); gradient.addColorStop(1, s.fillBottom);
          fill("close", height, gradient);
        }
        stroke(s.color, s.lineWidth, s.lineStyle);
        if (this.style === 14 && spacing > 4) for (const point of points) {
          ctx.beginPath(); ctx.arc(point.x, point.close, Math.min(4, Math.max(2, s.lineWidth + 1)), 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill();
        }
      }
      if (![0, 9, 12, 13].includes(this.style)) {
        const hovered = points.find((point) => point.bar.time === this.hoveredTime);
        if (hovered) { ctx.beginPath(); ctx.arc(hovered.x, hovered.close, 4, 0, Math.PI * 2); ctx.fillStyle = this.color(hovered.index); ctx.fill(); ctx.strokeStyle = this.background; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.restore();
    });
  }

  destroy() {
    cancelAnimationFrame(this.colorFrame);
    if (this.dragging !== null) this.endDrag(false);
    this.element.removeEventListener("pointerdown", this.pointerDown, true);
    this.element.removeEventListener("pointermove", this.pointerMove, true);
    this.element.removeEventListener("pointerup", this.pointerUp, true);
    this.element.removeEventListener("pointercancel", this.pointerCancel, true);
    window.removeEventListener("keydown", this.keyDown, true);
    this.chart.unsubscribeCrosshairMove(this.crosshair);
    if (this.realPriceLine) this.series.removePriceLine(this.realPriceLine);
    this.series.detachPrimitive(this);
  }
}
