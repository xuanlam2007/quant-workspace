import type { ReferencePoint } from "@/lib/reference-studies";

function equalRecord<T>(a: Record<string, T>, b: Record<string, T>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}

function equalPoint(a: ReferencePoint, b: ReferencePoint) {
  return a.time === b.time && a.isProjection === b.isProjection && Object.is(a.high, b.high)
    && Object.is(a.low, b.low) && equalRecord(a.values, b.values) && equalRecord(a.colors, b.colors);
}

export function updateReferenceSeries(series: {
  setData: (points: ReferencePoint[]) => void;
  update: (point: ReferencePoint) => void;
}, previous: ReferencePoint[], next: ReferencePoint[]) {
  // Chỉ báo có thể sửa lịch sử hoặc điểm chiếu; chỉ cập nhật đuôi khi tiền tố còn nguyên.
  const prefix = Math.max(0, previous.length - 1);
  let samePrefix = previous.length > 0 && next.length >= previous.length && previous.at(-1)?.time === next[prefix]?.time;
  for (let index = 0; samePrefix && index < prefix; index++) samePrefix = equalPoint(previous[index], next[index]);
  if (!samePrefix) {
    series.setData(next);
    return;
  }
  for (let index = prefix; index < next.length; index++) {
    if (!previous[index] || !equalPoint(previous[index], next[index])) series.update(next[index]);
  }
}
