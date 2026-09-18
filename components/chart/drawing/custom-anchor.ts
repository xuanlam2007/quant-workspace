import {
  LineAnchorRenderer,
  type CanvasRenderingTarget2D,
  type LineAnchorRendererData,
  type Point,
} from "lightweight-charts-line-tools-core";

const ANCHOR_HOVER_TOLERANCE = 8;
const hoveredAnchorIndices = new WeakMap<object, number | null>();
let enhancementInstalled = false;

export function drawAnchorHoverHalo(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  radius: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.32;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius + 2.5, 0, 2 * Math.PI, true);
  ctx.stroke();
  ctx.restore();
}

function drawAnchorBody(
  ctx: CanvasRenderingContext2D,
  point: Point & { square: boolean },
  radius: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
) {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  if (point.square) {
    const size = 2 * radius;
    ctx.rect(point.x - radius, point.y - radius, size, size);
  } else {
    ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI, true);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function installAnchorHoverEnhancement() {
  if (enhancementInstalled) return;
  enhancementInstalled = true;

  const originalHitTest = LineAnchorRenderer.prototype.hitTest;
  LineAnchorRenderer.prototype.hitTest = function hitTestEnhancedAnchor(x, y) {
    const data = (this as unknown as { _data: LineAnchorRendererData | null })._data;
    let hoveredIndex: number | null = null;

    if (data) {
      const threshold = data.radius + ANCHOR_HOVER_TOLERANCE;
      for (const point of data.points) {
        if (Math.hypot(point.x - x, point.y - y) <= threshold) {
          hoveredIndex = point.data;
          break;
        }
      }
    }

    hoveredAnchorIndices.set(this, hoveredIndex);
    return originalHitTest.call(this, x, y);
  };

  LineAnchorRenderer.prototype.draw = function drawEnhancedAnchors(target: CanvasRenderingTarget2D) {
    const data = (this as unknown as { _data: LineAnchorRendererData | null })._data;
    if (!data?.visible) return;

    target.useMediaCoordinateSpace(({ context }) => {
      const strokeWidth = Math.max(1.5, data.strokeWidth);
      for (let index = 0; index < data.points.length; index += 1) {
        const point = data.points[index];
        if (Number.isInteger(point.data) && data.editedPointIndex === point.data) continue;

        const hovered = hoveredAnchorIndices.get(this) === point.data;
        if (hovered) drawAnchorHoverHalo(context, point, data.radius, data.color);

        drawAnchorBody(
          context,
          point,
          data.radius,
          data.backgroundColors[index],
          data.color,
          strokeWidth,
        );
      }
    });
  };
}
