export interface NumericRange {
  from: number;
  to: number;
}

export interface WheelState {
  totalX: number;
  totalY: number;
  lastTime: number;
}

export function bundleWheelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  timeStamp: number,
  previous: WheelState,
) {
  const reset = timeStamp - previous.lastTime > 100;
  const totalX = (reset ? 0 : previous.totalX) + deltaX;
  const totalY = (reset ? 0 : previous.totalY) + deltaY;
  let x = deltaX;
  let y = deltaY;
  if (totalX !== 0 && totalY !== 0) {
    if (Math.abs(totalX) >= Math.abs(3 * totalY)) y = 0;
    if (Math.abs(totalY) >= Math.abs(3 * totalX)) x = 0;
  }
  const modeFactor = deltaMode === 2 ? 120 : deltaMode === 1 ? 32 : 1;
  return {
    x: x * modeFactor / 100,
    y: y * modeFactor / 100,
    state: { totalX, totalY, lastTime: timeStamp },
  };
}

export function bundleTimeWheelRange(
  range: NumericRange,
  normalizedDeltaY: number,
  pointerFraction?: number,
): NumericRange | null {
  const span = range.to - range.from;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(normalizedDeltaY)) return null;
  const zoom = -Math.sign(normalizedDeltaY) * Math.min(1, Math.abs(normalizedDeltaY));
  const factor = 1 + zoom / 10;
  const nextSpan = span / factor;
  if (pointerFraction === undefined) return { from: range.to - nextSpan, to: range.to };
  const fraction = Math.max(0, Math.min(1, pointerFraction));
  const anchor = range.from + span * fraction;
  return { from: anchor - nextSpan * fraction, to: anchor + nextSpan * (1 - fraction) };
}

export function bundlePriceWheelRange(
  range: NumericRange,
  height: number,
  pointerY: number,
  normalizedDeltaY: number,
): NumericRange | null {
  const span = range.to - range.from;
  if (!Number.isFinite(span) || span <= 0 || height <= 0 || !Number.isFinite(normalizedDeltaY)) return null;
  const start = height - Math.max(0, Math.min(height, pointerY));
  const target = Math.max(0, start - 15 * normalizedDeltaY);
  const padding = 0.2 * (height - 1);
  if (target + padding <= 0) return null;
  const factor = Math.max((start + padding) / (target + padding), 0.1);
  const center = (range.from + range.to) / 2;
  const half = span * factor / 2;
  return { from: center - half, to: center + half };
}

export function selectedZoomRange(first: number, second: number, minimumSpan: number): NumericRange | null {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const from = Math.min(first, second);
  const to = Math.max(first, second);
  return to - from >= minimumSpan ? { from, to } : null;
}
