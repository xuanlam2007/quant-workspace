import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import {
  createLineToolsPlugin,
  type ILineToolsPlugin,
} from "lightweight-charts-line-tools-core";
import {
  LineToolArrow,
  LineToolCallout,
  LineToolCrossLine,
  LineToolExtendedLine,
  LineToolHorizontalLine,
  LineToolHorizontalRay,
  LineToolRay,
  LineToolTrendLine,
  LineToolVerticalLine,
} from "lightweight-charts-line-tools-lines";
import { LineToolRectangle } from "lightweight-charts-line-tools-rectangle";
import { LineToolFibRetracement } from "lightweight-charts-line-tools-fib-retracement";
import { LineToolPriceRange } from "lightweight-charts-line-tools-price-range";
import { LineToolLongShortPosition } from "lightweight-charts-line-tools-long-short-position";
import { LineToolText } from "lightweight-charts-line-tools-text";

function createPaneCoordinateChart(chart: IChartApi): IChartApi {
  const chartElement = chart.chartElement();
  const elementProxy = new Proxy(chartElement, {
    get(target, property) {
      if (property === "getBoundingClientRect") {
        return () => {
          const rect = target.getBoundingClientRect();
          const leftInset = chart.priceScale("left").width();
          return new DOMRect(
            rect.x + leftInset,
            rect.y,
            Math.max(0, rect.width - leftInset),
            rect.height
          );
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  // Chuẩn hóa tọa độ plugin theo vùng pane, loại trừ trục giá trái.
  return new Proxy(chart, {
    get(target, property) {
      if (property === "chartElement") return () => elementProxy;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createDrawingTools(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick", Time>
): ILineToolsPlugin {
  const lineTools = createLineToolsPlugin(createPaneCoordinateChart(chart), series);
  lineTools.registerLineTool("TrendLine", LineToolTrendLine);
  lineTools.registerLineTool("Arrow", LineToolArrow);
  lineTools.registerLineTool("Ray", LineToolRay);
  lineTools.registerLineTool("ExtendedLine", LineToolExtendedLine);
  lineTools.registerLineTool("HorizontalLine", LineToolHorizontalLine);
  lineTools.registerLineTool("HorizontalRay", LineToolHorizontalRay);
  lineTools.registerLineTool("VerticalLine", LineToolVerticalLine);
  lineTools.registerLineTool("CrossLine", LineToolCrossLine);
  lineTools.registerLineTool("Callout", LineToolCallout);
  lineTools.registerLineTool("Rectangle", LineToolRectangle);
  lineTools.registerLineTool("FibRetracement", LineToolFibRetracement);
  lineTools.registerLineTool("PriceRange", LineToolPriceRange);
  lineTools.registerLineTool("LongShortPosition", LineToolLongShortPosition);
  lineTools.registerLineTool("Text", LineToolText);
  return lineTools;
}
