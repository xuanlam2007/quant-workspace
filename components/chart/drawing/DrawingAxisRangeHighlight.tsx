import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { LineToolExport, LineToolType } from "lightweight-charts-line-tools-core";

interface DrawingAxisRangeHighlightProps {
  drawing: LineToolExport<LineToolType>;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  chartTop: number;
  viewportVersion: number;
}

export function DrawingAxisRangeHighlight({
  drawing,
  chart,
  series,
  chartTop,
  viewportVersion,
}: DrawingAxisRangeHighlightProps) {
  void viewportVersion;

  const coordinates = drawing.points.flatMap((point) => {
    const x = chart.timeScale().timeToCoordinate(point.timestamp as Time);
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? [] : [{ x, y }];
  });
  if (coordinates.length < 2) return null;

  const xValues = coordinates.map(({ x }) => x);
  const yValues = coordinates.map(({ y }) => y);
  const priceScaleWidth = chart.priceScale("left").width();
  const timeScaleWidth = chart.timeScale().width();
  const timeScaleHeight = chart.timeScale().height();
  const paneHeight = chart.paneSize().height;
  const xStart = Math.max(0, Math.min(timeScaleWidth, Math.min(...xValues)));
  const xEnd = Math.max(0, Math.min(timeScaleWidth, Math.max(...xValues)));
  const yStart = Math.max(0, Math.min(paneHeight, Math.min(...yValues)));
  const yEnd = Math.max(0, Math.min(paneHeight, Math.max(...yValues)));

  return (
    <>
      {priceScaleWidth > 0 && yEnd > yStart && (
        <div
          className="drawing-axis-range drawing-axis-range--price"
          style={{
            top: chartTop + yStart,
            width: priceScaleWidth,
            height: yEnd - yStart,
          }}
          aria-hidden="true"
        />
      )}
      {timeScaleHeight > 0 && xEnd > xStart && (
        <div
          className="drawing-axis-range drawing-axis-range--time"
          style={{
            left: xStart,
            top: chartTop + paneHeight,
            width: xEnd - xStart,
            height: timeScaleHeight,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
