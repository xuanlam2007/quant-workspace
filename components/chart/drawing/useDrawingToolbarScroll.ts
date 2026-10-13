import { useCallback, useEffect, useRef, useState } from "react";

export function useDrawingToolbarScroll(onScroll: () => void) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = viewport.scrollTop > 1;
    const bottom = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
    setEdges((previous) => previous.top === top && previous.bottom === bottom ? previous : { top, bottom });
  }, []);

  const cancel = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    measure();
    const scrolled = () => { onScrollRef.current(); measure(); };
    viewport.addEventListener("scroll", scrolled, { passive: true });
    viewport.addEventListener("wheel", cancel, { passive: true });
    viewport.addEventListener("pointerdown", cancel, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", scrolled);
      viewport.removeEventListener("wheel", cancel);
      viewport.removeEventListener("pointerdown", cancel);
      cancel();
    };
  }, [cancel, measure]);

  const scrollPage = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    cancel();
    onScrollRef.current();
    const start = viewport.scrollTop;
    const destination = Math.round(Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, start + direction * Math.max(0, viewport.clientHeight - 50))));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewport.scrollTop = destination;
      measure();
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 350);
      const eased = progress < 0.5 ? 4 * progress ** 3 : (progress - 1) * (2 * progress - 2) ** 2 + 1;
      viewport.scrollTop = start + (destination - start) * eased;
      measure();
      frameRef.current = progress < 1 ? requestAnimationFrame(tick) : 0;
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  return { viewportRef, contentRef, edges, scrollPage };
}
