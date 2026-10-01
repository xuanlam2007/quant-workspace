import { useEffect, useRef } from "react";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import {
  interpolateLogicalIndexFromTime,
  logicalIndexToCoordinate,
  type ILineToolsPlugin,
  type LineToolExport,
  type LineToolType,
} from "lightweight-charts-line-tools-core";

interface DrawingAxisRangeHighlightProps {
  drawing: LineToolExport<LineToolType>;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  lineTools: ILineToolsPlugin;
  viewportVersion: number;
}

class AxisRangeView implements IPrimitivePaneView {
  range: { from: number; to: number } | null = null;

  constructor(private readonly axis: "price" | "time", private readonly priceSide: () => string) {}

  zOrder() { return "bottom" as const; }
  renderer() { return this; }

  draw(target: CanvasRenderingTarget2D) {
    const range = this.range;
    if (!range) return;
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      context.fillStyle = "rgba(41, 98, 255, 0.25)";
      if (this.axis === "price") {
        const from = Math.max(0, Math.floor(range.from * verticalPixelRatio));
        const to = Math.min(bitmapSize.height, Math.ceil(range.to * verticalPixelRatio));
        const border = Math.floor(horizontalPixelRatio);
        const left = this.priceSide() === "right" ? border : 0;
        if (to > from) context.fillRect(left, from, Math.max(0, bitmapSize.width - border), to - from);
      } else {
        const from = Math.max(0, Math.floor(range.from * horizontalPixelRatio));
        const to = Math.min(bitmapSize.width, Math.ceil(range.to * horizontalPixelRatio));
        const border = Math.floor(verticalPixelRatio);
        if (to > from) context.fillRect(from, border, to - from, Math.max(0, bitmapSize.height - border));
      }
    });
  }
}

class DrawingAxisRangePrimitive implements ISeriesPrimitive<Time> {
  private readonly priceView: AxisRangeView;
  private readonly timeView: AxisRangeView;
  private readonly priceViews: AxisRangeView[];
  private readonly timeViews: AxisRangeView[];
  private requestUpdate: (() => void) | null = null;

  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<"Candlestick">,
    private readonly lineTools: ILineToolsPlugin,
    private readonly drawing: () => LineToolExport<LineToolType>,
  ) {
    const priceSide = () => this.series.options().priceScaleId ?? "right";
    this.priceView = new AxisRangeView("price", priceSide);
    this.timeView = new AxisRangeView("time", priceSide);
    this.priceViews = [this.priceView];
    this.timeViews = [this.timeView];
  }

  attached({ requestUpdate }: SeriesAttachedParameter<Time>) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  refresh() { this.requestUpdate?.(); }
  priceAxisPaneViews() { return this.priceViews; }
  timeAxisPaneViews() { return this.timeViews; }

  updateAllViews() {
    this.priceView.range = null;
    this.timeView.range = null;
    try {
      // Đọc điểm hiện tại của plugin để vùng trục bám theo thao tác kéo.
      const current = this.drawing();
      const live = (JSON.parse(this.lineTools.getLineToolByID(current.id)) as LineToolExport<LineToolType>[])[0];
      if (!live || live.options.visible === false || live.points.length < 2) return;
      const xValues: number[] = [];
      const yValues: number[] = [];
      for (const point of live.points) {
        const logical = interpolateLogicalIndexFromTime(this.chart, this.series, point.timestamp as Time);
        const x = logical === null ? null : logicalIndexToCoordinate(this.chart.timeScale(), logical);
        const y = this.series.priceToCoordinate(point.price);
        if (x !== null && Number.isFinite(x)) xValues.push(x);
        if (y !== null && Number.isFinite(y)) yValues.push(y);
      }
      if (xValues.length > 1) this.timeView.range = { from: Math.min(...xValues), to: Math.max(...xValues) };
      if (yValues.length > 1) this.priceView.range = { from: Math.min(...yValues), to: Math.max(...yValues) };
    } catch {
      // Pane và trục có thể tạm thời chưa sẵn sàng trong lúc chuyển pane.
    }
  }
}

export function DrawingAxisRangeHighlight({ drawing, chart, series, lineTools, viewportVersion }: DrawingAxisRangeHighlightProps) {
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const primitiveRef = useRef<DrawingAxisRangePrimitive | null>(null);

  useEffect(() => {
    const primitive = new DrawingAxisRangePrimitive(chart, series, lineTools, () => drawingRef.current);
    primitiveRef.current = primitive;
    series.attachPrimitive(primitive);
    primitive.refresh();
    return () => {
      primitiveRef.current = null;
      try { series.detachPrimitive(primitive); }
      catch { /* Biểu đồ có thể đã được hủy khi component tháo gắn. */ }
    };
  }, [chart, series, lineTools]);

  useEffect(() => { primitiveRef.current?.refresh(); }, [drawing, viewportVersion]);
  return null;
}
