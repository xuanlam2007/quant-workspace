import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

export function useDraggablePanel(open: boolean) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const origin = useRef<{ x: number; y: number; left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => { if (!open) { setPosition(null); origin.current = null; setDragging(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const clampPosition = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition((current) => current ? {
        left: Math.max(0, Math.min(window.innerWidth - rect.width, current.left)),
        top: Math.max(0, Math.min(window.innerHeight - rect.height, current.top)),
      } : current);
    };
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [open]);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, textarea")) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    panelRef.current = panel;
    const rect = panel.getBoundingClientRect();
    origin.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = origin.current;
    if (!start) return;
    setPosition({
      left: Math.max(0, Math.min(Math.max(0, window.innerWidth - start.width), start.left + event.clientX - start.x)),
      top: Math.max(0, Math.min(Math.max(0, window.innerHeight - start.height), start.top + event.clientY - start.y)),
    });
  };
  const stop = (event: PointerEvent<HTMLElement>) => {
    origin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const style: CSSProperties | undefined = position ? { position: "fixed", left: position.left, top: position.top, bottom: "auto", right: "auto", margin: 0, transform: "none" } : undefined;
  return { style, handle: { onPointerDown, onPointerMove, onPointerUp: stop, onPointerCancel: stop, onLostPointerCapture: stop, style: { touchAction: "none", userSelect: "none", cursor: dragging ? "grabbing" : "grab" } as CSSProperties } };
}
