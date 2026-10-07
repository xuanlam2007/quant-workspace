export function createChartRenderScheduler(
  visible: () => boolean,
  render: (rebuild: boolean) => void,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
) {
  let frame: number | undefined;
  let dirty = false;
  let rebuild = false;
  let disposed = false;
  const cancel = () => {
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
  };
  const flush = () => {
    cancel();
    if (disposed || !dirty) return;
    if (!visible()) { rebuild = true; return; }
    const full = rebuild;
    dirty = false;
    rebuild = false;
    render(full);
  };
  return {
    schedule() {
      if (disposed) return;
      dirty = true;
      if (!visible()) { rebuild = true; return; }
      if (frame === undefined) frame = requestFrame(flush);
    },
    flush,
    suspend() { cancel(); if (dirty) rebuild = true; },
    dispose() { disposed = true; dirty = false; cancel(); },
  };
}
