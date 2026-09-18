import { LineStyle, type IChartApiBase, type IHorzScaleBehavior, type ISeriesApi, type SeriesType } from "lightweight-charts";
import {
  LineCap,
  LineEnd,
  LineJoin,
  LineToolPaneView,
  PaneCursorType,
  Point,
  SegmentRenderer,
  deepCopy,
  setLineStyle,
  type CanvasRenderingTarget2D,
  type DeepPartial,
  type IPaneRenderer,
  type LineToolOptionsInternal,
  type LineToolPoint,
  type LineToolsCorePlugin,
  type PriceAxisLabelStackingManager,
} from "lightweight-charts-line-tools-core";
import { LineToolArrow } from "lightweight-charts-line-tools-lines";

interface SharpArrowRendererData {
  point0: Point;
  point1: Point;
  color: string;
  width: number;
  style: LineStyle;
}

export function getSharpArrowPoints(point0: Point, point1: Point, width: number): [Point, Point][] {
  const diff = point1.subtract(point0);
  const direction = diff.normalized();
  let length = Math.max(10, 5 * width);
  length = Math.min(length, 0.35 * diff.length());

  const basePoint = point1.subtract(direction.scaled(length));
  const spreadVector = direction.transposed().scaled(0.7 * length);
  const wingLeft = basePoint.add(spreadVector);
  const wingRight = basePoint.subtract(spreadVector);

  return [
    [wingLeft, point1],
    [wingRight, point1],
  ];
}

class SharpArrowRenderer implements IPaneRenderer {
  private _data: SharpArrowRendererData | null = null;

  setData(data: SharpArrowRendererData) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data) return;
    const data = this._data;

    target.useMediaCoordinateSpace(({ context }) => {
      const wings = getSharpArrowPoints(data.point0, data.point1, data.width);
      context.save();
      context.strokeStyle = data.color;
      context.lineWidth = data.width;
      context.lineCap = "butt";
      context.lineJoin = "miter";
      context.miterLimit = 10;
      setLineStyle(context, data.style);
      context.beginPath();
      context.moveTo(wings[0][0].x, wings[0][0].y);
      context.lineTo(wings[0][1].x, wings[0][1].y);
      context.lineTo(wings[1][0].x, wings[1][0].y);
      context.stroke();
      context.restore();
    });
  }
}

class SharpArrowPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
  private readonly _segmentRenderer = new SegmentRenderer<HorzScaleItem>();
  private readonly _arrowRenderer = new SharpArrowRenderer();

  protected _updateImpl(): void {
    this._invalidated = false;
    this._renderer.clear();

    const options = this._tool.options();
    if (!options.visible || this._tool.points().length < 2 || this._tool.isCulled()) return;
    if (!this._updatePoints()) return;

    const [point0, point1] = this._points;
    const line = deepCopy(options.line);
    line.join = line.join || LineJoin.Miter;
    line.cap = line.cap || LineCap.Butt;
    line.end = { ...line.end, right: LineEnd.Normal };

    this._segmentRenderer.setData({
      points: [point0, point1],
      line,
      toolDefaultHoverCursor: options.defaultHoverCursor,
      toolDefaultDragCursor: options.defaultDragCursor,
    });
    this._renderer.append(this._segmentRenderer);

    this._arrowRenderer.setData({
      point0,
      point1,
      color: line.color,
      width: line.width,
      style: line.style,
    });
    this._renderer.append(this._arrowRenderer);

    this._renderer.append(this.createLineAnchor({
      points: [point0, point1],
      defaultAnchorHoverCursor: PaneCursorType.Pointer,
      defaultAnchorDragCursor: PaneCursorType.Grabbing,
    }, 0));
  }
}

export class LineToolSharpArrow<HorzScaleItem> extends LineToolArrow<HorzScaleItem> {
  constructor(
    coreApi: LineToolsCorePlugin<HorzScaleItem>,
    chart: IChartApiBase<HorzScaleItem>,
    series: ISeriesApi<SeriesType, HorzScaleItem>,
    horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
    options: DeepPartial<LineToolOptionsInternal<"Arrow">> | undefined,
    points: LineToolPoint[] | undefined,
    priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>,
  ) {
    super(
      coreApi,
      chart,
      series,
      horzScaleBehavior,
      options,
      points,
      priceAxisLabelStackingManager,
    );
    this._setPaneViews([new SharpArrowPaneView(this, chart, series)]);
  }
}
