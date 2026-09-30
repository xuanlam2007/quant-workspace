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
  let priceScaleWidth = 0;
  try {
    priceScaleWidth = chart.priceScale("left", series.getPane().paneIndex()).width();
  } catch {
    // Chờ trục giá của pane mới khởi tạo trước khi vẽ vùng chọn.
  }
  const timeScaleWidth = chart.timeScale().width();
  const timeScaleHeight = chart.timeScale().height();
  const pane = series.getPane();
  const paneHeight = chart.paneSize(pane.paneIndex()).height;
  const chartRect = chart.chartElement().getBoundingClientRect();
  const paneTop = (pane.getHTMLElement()?.getBoundingClientRect().top ?? chartRect.top) - chartRect.top;
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
            top: chartTop + paneTop + yStart,
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
            left: priceScaleWidth + xStart,
            top: chartTop + chartRect.height - timeScaleHeight,
            width: xEnd - xStart,
            height: timeScaleHeight,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
