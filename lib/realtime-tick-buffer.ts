export interface RealtimeTickBuffer<T> {
  push(value: T, consume: (value: T) => void): void;
  release(latestHistoryTime: number | undefined, consume: (value: T) => void): void;
  dispose(): void;
}

export function createRealtimeTickBuffer<T>(
  getBucketTime: (value: T) => number,
  maxPending = 1_000,
): RealtimeTickBuffer<T> {
  let released = false;
  let disposed = false;
  let queued: T[] = [];

  return {
    push(value, consume) {
      if (disposed) return;
      if (released) {
        consume(value);
        return;
      }
      queued.push(value);
      if (queued.length > maxPending) {
        queued.splice(0, queued.length - maxPending);
      }
    },
    release(latestHistoryTime, consume) {
      if (released || disposed) return;
      released = true;
      const buffered = queued;
      queued = [];
      buffered.forEach((value) => {
        const bucketTime = getBucketTime(value);
        if (latestHistoryTime === undefined || bucketTime > latestHistoryTime) {
          consume(value);
        }
      });
    },
    dispose() {
      disposed = true;
      queued = [];
    },
  };
}
