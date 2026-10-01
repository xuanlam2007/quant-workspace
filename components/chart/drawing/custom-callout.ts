import type { Coordinate } from "lightweight-charts";
import {
  HitTestResult,
  HitTestType,
  LineToolPaneView,
  PaneCursorType,
  Point,
  textWrap,
  type CalloutToolOptions,
  type CanvasRenderingTarget2D,
  type IPaneRenderer,
  type LineToolPoint,
} from "lightweight-charts-line-tools-core";
import { LineToolCallout } from "lightweight-charts-line-tools-lines";
import { VNDIRECT_CHART_FONT } from "./drawing-presets";

class CalloutRenderer implements IPaneRenderer {
  private data: { points: Point[]; options: CalloutToolOptions } | null = null;
  private layout: { left: number; top: number; width: number; height: number; lines: string[]; font: string } | null = null;
  private context: CanvasRenderingContext2D | null = null;

  setData(points: Point[], options: CalloutToolOptions) {
    this.data = { points, options };
    this.layout = null;
    this.context ??= document.createElement("canvas").getContext("2d");
    if (!this.context || points.length < 2) return;
    const { text } = options;
    const font = `${text.font.bold ? "bold " : ""}${text.font.italic ? "italic " : ""}${text.font.size}px ${VNDIRECT_CHART_FONT}`;
    const wrapWidth = typeof text.wordWrapWidth === "number" && text.wordWrapWidth > 0 ? text.wordWrapWidth : undefined;
    const lines = textWrap(text.value, font, wrapWidth);
    this.context.font = font;
    const width = (wrapWidth ?? Math.max(0, ...lines.map((line) => this.context!.measureText(line).width))) + 20;
    const height = text.font.size * lines.length + 20;
    this.layout = { left: points[1].x - width / 2, top: points[1].y - height / 2, width, height, lines, font };
  }

  draw(target: CanvasRenderingTarget2D) {
    const data = this.data;
    const layout = this.layout;
    if (!data || !layout) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const { left, top, width: w, height: h, font, lines } = layout;
      const tip = new Point(data.points[0].x - left, data.points[0].y - top);
      const side = (tip.x > w ? 20 : tip.x > 0 ? 10 : 0) + (tip.y > h ? 2 : tip.y > 0 ? 1 : 0);
      const wide = w - 16 > 16;
      const tall = h - 16 > 16;
      ctx.save();
      ctx.translate(left, top);
      ctx.lineCap = "round";
      ctx.lineWidth = data.options.line.width;
      ctx.strokeStyle = data.options.text.box.border?.color ?? "#0097a7";
      // Đường bao và đuôi dùng chung một nét theo module CalloutPaneView 70326.
      ctx.beginPath();
      ctx.moveTo(8, 0);
      if (side === 10) {
        if (wide) ctx.lineTo(w / 2 - 8, 0);
        ctx.lineTo(tip.x, tip.y);
        if (wide) ctx.lineTo(w / 2 + 8, 0);
      }
      ctx.lineTo(w - 8, 0);
      if (side === 20) { ctx.lineTo(tip.x, tip.y); ctx.lineTo(w, 8); }
      else ctx.arcTo(w, 0, w, 8, 8);
      if (side === 21) {
        if (tall) ctx.lineTo(w, h / 2 - 8);
        ctx.lineTo(tip.x, tip.y);
        if (tall) ctx.lineTo(w, h / 2 + 8);
      }
      ctx.lineTo(w, h - 8);
      if (side === 22) { ctx.lineTo(tip.x, tip.y); ctx.lineTo(w - 8, h); }
      else ctx.arcTo(w, h, w - 8, h, 8);
      if (side === 12) {
        if (wide) ctx.lineTo(w / 2 + 8, h);
        ctx.lineTo(tip.x, tip.y);
        if (wide) ctx.lineTo(w / 2 - 8, h);
      }
      ctx.lineTo(8, h);
      if (side === 2) { ctx.lineTo(tip.x, tip.y); ctx.lineTo(0, h - 8); }
      else ctx.arcTo(0, h, 0, h - 8, 8);
      if (side === 1) {
        if (tall) ctx.lineTo(0, h / 2 + 8);
        ctx.lineTo(tip.x, tip.y);
        if (tall) ctx.lineTo(0, h / 2 - 8);
      }
      ctx.lineTo(0, 8);
      if (side === 0) { ctx.lineTo(tip.x, tip.y); ctx.lineTo(8, 0); }
      else ctx.arcTo(0, 0, 8, 0, 8);
      ctx.stroke();
      ctx.fillStyle = data.options.text.box.background?.color ?? "rgba(0,151,167,0.7)";
      ctx.fill();
      ctx.font = font;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillStyle = data.options.text.font.color;
      lines.forEach((line, index) => ctx.fillText(line, 10, 10 + (index + 1) * data.options.text.font.size));
      ctx.restore();
    });
  }

  hitTest(x: Coordinate, y: Coordinate) {
    const tip = this.data?.points[0];
    if (tip && Math.hypot(x - tip.x, y - tip.y) < 3) {
      return new HitTestResult(HitTestType.ChangePoint, { pointIndex: 0, suggestedCursor: PaneCursorType.Pointer });
    }
    const box = this.layout;
    if (!box || x < box.left || x > box.left + box.width || y < box.top || y > box.top + box.height) return null;
    return new HitTestResult(HitTestType.MovePoint, { pointIndex: 1, labelBody: true, suggestedCursor: PaneCursorType.Pointer });
  }
}

class CalloutPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
  private readonly callout = new CalloutRenderer();

  protected _updateImpl() {
    this._invalidated = false;
    this._renderer.clear();
    if (!this._tool.options().visible || this._tool.isCulled() || !this._updatePoints() || this._points.length < 2) return;
    this.callout.setData(this._points, this._tool.options() as CalloutToolOptions);
    this._renderer.append(this.callout);
    this._renderer.append(this.createLineAnchor({ points: [this._points[0]], defaultAnchorHoverCursor: PaneCursorType.Pointer, defaultAnchorDragCursor: PaneCursorType.Grabbing }, 0));
  }
}

export class LineToolReferenceCallout<HorzScaleItem> extends LineToolCallout<HorzScaleItem> {
  private labelDragOffset: Point | null = null;

  constructor(...args: ConstructorParameters<typeof LineToolCallout<HorzScaleItem>>) {
    args[4] ??= {};
    Object.assign(args[4], { showPriceAxisLabels: true, showTimeAxisLabels: true });
    super(...args);
    this._setPaneViews([new CalloutPaneView(this, this._chart, this._series)]);
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
