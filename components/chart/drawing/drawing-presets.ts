import { LineStyle } from "lightweight-charts";
import type {
  LineToolExport,
  LineToolPartialOptionsMap,
  LineToolType,
} from "lightweight-charts-line-tools-core";

const BLUE = "#2962ff";

const LINE = {
  color: BLUE,
  width: 2,
  style: LineStyle.Solid,
};

const FIB_LEVELS = [
  { coeff: 0, color: "#787b86", opacity: 0.12 },
  { coeff: 0.236, color: "#f23645", opacity: 0.15 },
  { coeff: 0.382, color: "#ff9800", opacity: 0.14 },
  { coeff: 0.5, color: "#4caf50", opacity: 0.14 },
  { coeff: 0.618, color: "#089981", opacity: 0.14 },
  { coeff: 0.786, color: "#64b5f6", opacity: 0.15 },
  { coeff: 1, color: "#2962ff", opacity: 0.16 },
  { coeff: 1.618, color: "#2962ff", opacity: 0.16 },
  { coeff: 2.618, color: "#f23645", opacity: 0.16 },
  { coeff: 3.618, color: "#9c27b0", opacity: 0.16 },
].map((level) => ({
  ...level,
  distanceFromCoeffEnabled: false,
  distanceFromCoeff: 0,
}));

export function drawingPreset<T extends LineToolType>(type: T): LineToolPartialOptionsMap[T] {
  if (type === "FibRetracement") {
    return {
      line: { width: 1, style: LineStyle.Dashed },
      levels: FIB_LEVELS,
    } as LineToolPartialOptionsMap[T];
  }

  if (type === "PriceRange") {
    return {
      text: { font: { color: "#ffffff", size: 12 } },
      priceRange: {
        rectangle: {
          background: { color: "rgba(235, 77, 92, 0.22)" },
          border: { color: "#eb4d5c", width: 1, style: LineStyle.Dashed },
        },
        verticalLine: { color: "#eb4d5c", width: 1, style: LineStyle.Dashed },
        horizontalLine: { color: "#eb4d5c", width: 1, style: LineStyle.Dashed },
        showTopPrice: false,
        showBottomPrice: false,
      },
    } as LineToolPartialOptionsMap[T];
  }

  if (type === "Text") {
    return {
      text: {
        value: "Văn bản",
        font: { color: BLUE, size: 14, bold: false, italic: false, family: "Helvetica" },
        wordWrapWidth: 0,
      },
    } as LineToolPartialOptionsMap[T];
  }

  if (["Rectangle"].includes(type)) {
    return {
      rectangle: {
        background: { color: "rgba(41, 98, 255, 0.12)" },
        border: LINE,
      },
    } as LineToolPartialOptionsMap[T];
  }

  return { line: LINE } as LineToolPartialOptionsMap[T];
}

export function priceRangeAppearance(tool: LineToolExport<LineToolType>) {
  if (tool.toolType !== "PriceRange" || tool.points.length < 2) return null;
  const rising = tool.points[1].price >= tool.points[0].price;
  const color = rising ? "#53b987" : "#eb4d5c";
  return {
    ...tool.options,
    text: {
      ...tool.options.text,
      font: { ...tool.options.text.font, color: "#ffffff" },
    },
    priceRange: {
      ...tool.options.priceRange,
      rectangle: {
        ...tool.options.priceRange.rectangle,
        background: { color: rising ? "rgba(83, 185, 135, 0.22)" : "rgba(235, 77, 92, 0.22)" },
        border: { ...tool.options.priceRange.rectangle.border, color },
      },
      verticalLine: { ...tool.options.priceRange.verticalLine, color },
      horizontalLine: { ...tool.options.priceRange.horizontalLine, color },
      showTopPrice: false,
      showBottomPrice: false,
    },
  };
}

export function normalizeDrawingState(serialized: string) {
  try {
    const drawings = JSON.parse(serialized) as LineToolExport<LineToolType>[];
    const normalized = drawings.map((tool) => {
      const appearance = priceRangeAppearance(tool);
      return appearance ? { ...tool, options: appearance } : tool;
    });
    return JSON.stringify(normalized);
  } catch {
    return serialized;
  }
}
