import type { Coordinate, IChartApiBase } from "lightweight-charts";
import {
  HitTestResult,
  HitTestType,
  LineToolPaneView,
  PaneCursorType,
  Point,
  type CanvasRenderingTarget2D,
  type IPaneRenderer,
  type LineToolPoint,
  type TextOptions,
  type TextToolOptions,
} from "lightweight-charts-line-tools-core";
import { LineToolText } from "lightweight-charts-line-tools-text";
import { LineToolCallout } from "lightweight-charts-line-tools-lines";
import { priceNoteSettings, priceNoteVisible, type PriceNoteOptions, type PriceNoteSettings } from "./price-note-options";
import { VNDIRECT_CHART_FONT } from "./drawing-presets";

declare module "lightweight-charts-line-tools-core" {
  interface LineToolOptionsMap {
    PriceLabel: TextToolOptions;
    PriceNote: PriceNoteOptions;
  }
}

const noteResolutions = new WeakMap<object, () => string>();
export function registerPriceNoteResolution<HorzScaleItem>(chart: IChartApiBase<HorzScaleItem>, resolution: () => string) {
  noteResolutions.set(chart, resolution);
}

interface AnnotationData {
  points: Point[];
  label: string;
  text: TextOptions;
  note: boolean;
  customText?: PriceNoteSettings;
  lineColor: string;
  chartBackground: string;
}

class PriceAnnotationRenderer implements IPaneRenderer {
  private data: AnnotationData | null = null;
  private box: { x: number; y: number; width: number; height: number } | null = null;
  private measurementContext: CanvasRenderingContext2D | null = null;

  setData(data: AnnotationData) {
    this.data = data;
    this.measurementContext ??= document.createElement("canvas").getContext("2d");
    this.box = this.measurementContext ? this.layout(this.measurementContext, data) : null;
  }

  private layout(ctx: CanvasRenderingContext2D, data: AnnotationData) {
    if (!data.points.length || data.note && data.points.length < 2) return null;
    const { font } = data.text;
    ctx.font = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${font.size}px ${VNDIRECT_CHART_FONT}`;
    const width = ctx.measureText(data.label).width + (data.note ? 16 : 20);
    const height = font.size + (data.note ? 12 : 10);
    const origin = data.points[0];
    let x = origin.x + 9;
    let y = origin.y - height - 15;
    if (data.note) {
      const anchor = data.points[1];
      const angle = Math.round(180 * Math.atan2(anchor.y - origin.y, anchor.x - origin.x) / Math.PI);
      if (angle >= -135 && angle <= -45) { x = anchor.x - width / 2; y = anchor.y - height; }
      else if (angle > -45 && angle < 45) { x = anchor.x; y = anchor.y - height / 2; }
      else if (angle >= 45 && angle <= 135) { x = anchor.x - width / 2; y = anchor.y; }
      else { x = anchor.x - width; y = anchor.y - height / 2; }
    }
    return { x, y, width, height };
  }

  private customTextLayout(ctx: CanvasRenderingContext2D, data: AnnotationData) {
    const note = data.customText;
    if (!note?.showLabel || !note.value || data.points.length < 2) return null;
    const [first, second] = data.points;
    const left = first.x < second.x ? first : second;
    const right = left === first ? second : first;
    const anchor = note.horizontal === "left" ? left : note.horizontal === "right" ? right : new Point((first.x + second.x) / 2, (first.y + second.y) / 2);
    ctx.font = `${note.font.italic ? "italic " : ""}${note.font.bold ? "bold " : ""}${note.font.size}px ${VNDIRECT_CHART_FONT}`;
    const lines = note.value.split("\n");
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const height = lines.length * note.font.size * 1.2;
    const x = note.horizontal === "left" ? 0 : note.horizontal === "right" ? -width : -width / 2;
    const y = note.vertical === "top" ? -height - 2 : note.vertical === "bottom" ? 2 : -height / 2;
    const angle = Math.atan((right.y - left.y) / (right.x - left.x || Number.EPSILON));
    return { anchor, angle, x, y, width, height, lines, note };
  }

  draw(target: CanvasRenderingTarget2D) {
    const data = this.data;
    if (!data?.points.length || data.note && data.points.length < 2) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const { font, box } = data.text;
      const size = font.size;
      ctx.save();
      const custom = this.customTextLayout(ctx, data);
      if (custom) {
        ctx.save();
        ctx.translate(custom.anchor.x, custom.anchor.y);
        ctx.rotate(custom.angle);
        ctx.fillStyle = custom.note.font.color;
        ctx.textAlign = custom.note.horizontal;
        ctx.textBaseline = "top";
        const textX = custom.note.horizontal === "left" ? custom.x : custom.note.horizontal === "right" ? custom.x + custom.width : custom.x + custom.width / 2;
        custom.lines.forEach((line, index) => ctx.fillText(line, textX, custom.y + index * custom.note.font.size * 1.2));
        ctx.restore();
      }
      const layout = this.layout(ctx, data);
      if (!layout) { ctx.restore(); return; }
      const { x, y, width, height } = layout;
      const origin = data.points[0];
      const anchor = data.note ? data.points[1] : origin;
      if (data.note) {
        ctx.save();
        if (custom?.note.vertical === "middle") {
          // Loại vùng chữ khỏi đường nối theo PriceNotePaneView của bundle.
          ctx.beginPath();
          ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
          const corners = [[custom.x - 2, custom.y], [custom.x + custom.width + 2, custom.y], [custom.x + custom.width + 2, custom.y + custom.height], [custom.x - 2, custom.y + custom.height]];
          corners.forEach(([x, y], index) => {
            const px = custom.anchor.x + x * Math.cos(custom.angle) - y * Math.sin(custom.angle);
            const py = custom.anchor.y + x * Math.sin(custom.angle) + y * Math.cos(custom.angle);
            if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.clip("evenodd");
        }
        ctx.strokeStyle = data.lineColor;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(anchor.x, anchor.y);
        ctx.stroke();
        ctx.restore();
      }
      this.box = { x, y, width, height };
      ctx.translate(x + .5, y + .5);
      ctx.beginPath();
      if (data.note) {
        ctx.roundRect(0, 0, width, height, 4);
      } else {
        // Hình nhãn và đuôi lấy từ PriceLabelPaneView, module 86583.
        ctx.moveTo(12, height);
        ctx.lineTo(-9, height + 15);
        ctx.lineTo(-10, height + 14);
        ctx.lineTo(5, height);
        ctx.lineTo(3, height);
        ctx.arcTo(0, height, 0, 0, 3);
        ctx.lineTo(0, 3);
        ctx.arcTo(0, 0, width, 0, 3);
        ctx.lineTo(width - 3, 0);
        ctx.arcTo(width, 0, width, height, 3);
        ctx.lineTo(width, height - 3);
        ctx.arcTo(width, height, 0, height, 3);
        ctx.lineTo(12, height);
      }
      ctx.closePath();
      ctx.fillStyle = box.background?.color ?? "#2962ff";
      ctx.fill();
      ctx.strokeStyle = box.border?.color ?? "#2962ff";
      ctx.lineWidth = data.note ? 1 : 2;
      ctx.stroke();
      ctx.fillStyle = font.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(data.label, data.note ? 8 : 10, height / 2 + Math.floor(.35 * size));
      ctx.translate(-x - .5, -y - .5);
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, data.note ? 2 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = data.note ? data.lineColor : box.border?.color ?? "#2962ff";
      ctx.fill();
      ctx.strokeStyle = data.chartBackground;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  }

  hitTest(x: Coordinate, y: Coordinate) {
    const data = this.data;
    if (!data) return null;
    const custom = this.measurementContext && this.customTextLayout(this.measurementContext, data);
    if (custom) {
      const dx = x - custom.anchor.x, dy = y - custom.anchor.y;
      const localX = dx * Math.cos(custom.angle) + dy * Math.sin(custom.angle);
      const localY = -dx * Math.sin(custom.angle) + dy * Math.cos(custom.angle);
      if (localX >= custom.x && localX <= custom.x + custom.width && localY >= custom.y && localY <= custom.y + custom.height) {
        return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor: PaneCursorType.Pointer });
      }
    }
    const box = this.box;
    if (box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
      return new HitTestResult(HitTestType.MovePoint, { pointIndex: data.note ? 1 : 0, labelBody: true, suggestedCursor: PaneCursorType.Pointer });
    }
    if (data.note && data.points.length >= 2) {
      const [a, b] = data.points;
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const ratio = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      if (Math.hypot(x - a.x - ratio * dx, y - a.y - ratio * dy) <= 3) {
        return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor: PaneCursorType.Pointer });
      }
    }
    return null;
  }
}

class PriceAnnotationPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
  private readonly annotation = new PriceAnnotationRenderer();

  protected _updateImpl() {
    this._invalidated = false;
    this._renderer.clear();
    if (!this._tool.options().visible || !this._tool.points().length || this._tool.isCulled() || !this._updatePoints()) return;
    const options = this._tool.options();
    const background = this._chart.options().layout.background;
    this.annotation.setData({
      points: this._points,
      label: this._series.priceFormatter().format(this._tool.points()[0].price),
      text: options.text,
      note: this._tool.toolType === "PriceNote",
      customText: this._tool.toolType === "PriceNote" ? priceNoteSettings(options as PriceNoteOptions) : undefined,
      lineColor: options.line?.color ?? "#2962ff",
      chartBackground: "color" in background ? background.color : background.topColor,
    });
    this._renderer.append(this.annotation);
    this._renderer.append(this.createLineAnchor({
      points: this._points,
      defaultAnchorHoverCursor: PaneCursorType.Pointer,
      defaultAnchorDragCursor: PaneCursorType.Grabbing,
    }, 0));
  }
}

export class LineToolPriceLabel<HorzScaleItem> extends LineToolText<HorzScaleItem> {
  readonly toolType = "PriceLabel" as const;
  private labelDragOffset: Point | null = null;

  constructor(...args: ConstructorParameters<typeof LineToolText<HorzScaleItem>>) {
    args[4] ??= {};
    Object.assign(args[4], { showPriceAxisLabels: true, showTimeAxisLabels: true });
    super(...args);
    this._setPaneViews([new PriceAnnotationPaneView(this, this._chart, this._series)]);
  }

  _internalHitTest(x: Coordinate, y: Coordinate) {
    const renderer = this._paneViews[0]?.renderer() as IPaneRenderer | null | undefined;
    const hit = renderer?.hitTest?.(x, y) ?? null;
    if (!this.isEditing() && !this.isCreating()) {
      const anchor = this.points()[0] && this.pointToScreenPoint(this.points()[0]);
      this.labelDragOffset = hit?.data()?.labelBody && anchor ? new Point(anchor.x - x, anchor.y - y) : null;
    }
    return hit;
  }

  setPoint(index: number, point: LineToolPoint) {
    const screen = this.labelDragOffset && this.isEditing() ? this.pointToScreenPoint(point) : null;
    const adjusted = screen && this.labelDragOffset ? this.screenPointToPoint(screen.add(this.labelDragOffset)) : null;
    super.setPoint(index, adjusted ?? point);
  }
}

export class LineToolPriceNote<HorzScaleItem> extends LineToolCallout<HorzScaleItem> {
  readonly toolType = "PriceNote" as const;
  private labelDragOffset: Point | null = null;

  constructor(...args: ConstructorParameters<typeof LineToolCallout<HorzScaleItem>>) {
    args[4] ??= {};
    Object.assign(args[4], { showPriceAxisLabels: true, showTimeAxisLabels: true });
    super(...args);
    this._setPaneViews([new PriceAnnotationPaneView(this, this._chart, this._series)]);
  }

  isCulled(): boolean {
    return !priceNoteVisible(this.options() as PriceNoteOptions, noteResolutions.get(this._chart)?.() ?? "D") || super.isCulled();
  }

  _internalHitTest(x: Coordinate, y: Coordinate) {
    if (this.isCulled()) return null;
    const renderer = this._paneViews[0]?.renderer() as IPaneRenderer | null | undefined;
    const hit = renderer?.hitTest?.(x, y) ?? null;
    if (!this.isEditing() && !this.isCreating()) {
      const anchor = this.points()[1] && this.pointToScreenPoint(this.points()[1]);
      this.labelDragOffset = hit?.data()?.labelBody && anchor ? new Point(anchor.x - x, anchor.y - y) : null;
    }
    return hit;
  }

  setPoint(index: number, point: LineToolPoint) {
    const screen = index === 1 && this.labelDragOffset && this.isEditing() ? this.pointToScreenPoint(point) : null;
    const adjusted = screen && this.labelDragOffset ? this.screenPointToPoint(screen.add(this.labelDragOffset)) : null;
    super.setPoint(index, adjusted ?? point);
  }
}
