"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { DRAWING_TOOL_GROUPS, type DrawingToolOption } from "../config/chart-config";
import { FAVORITE_ICONS } from "../ui/favorite-icons";
import { VNDIRECT_TOOLBAR_ICONS } from "./vndirect-icons";

const TOOLS = new Map(DRAWING_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => [tool.id, tool] as const)));
const POSITION_KEY = "chart.favoriteDrawingsPosition";
const VISIBILITY_DURATION = 160;
const REMOVAL_DURATION = 180;
type Position = { left: number; top: number };
interface Gesture {
  pointer: number;
  kind: "move" | "sort";
  toolId?: string;
  startX: number;
  startY: number;
  origin: Position;
  originalOrder: string[];
  moved: boolean;
  sortable: boolean;
}
interface Props {
  ids: string[];
  visible: boolean;
  locked: boolean;
  activeId?: string;
  onSelect: (tool: DrawingToolOption) => void;
  onReorder: (ids: string[]) => void;
  onHide: () => void;
}

export function FavoriteDrawingToolbar({ ids, visible, locked, activeId, onSelect, onReorder, onHide }: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressedClick = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onReorder, onHide });
  callbacks.current = { onReorder, onHide };
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 100, top: 100 });
  const positionRef = useRef(position);
  const preferredPosition = useRef<Position | null>(null);
  const cancelGesture = useRef<() => void>(() => {});
  const openedAt = useRef(0);
  const [vertical, setVertical] = useState(false);
  const verticalRef = useRef(vertical);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [displayIds, setDisplayIds] = useState(ids);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const orderRef = useRef(ids);
  if (!gesture.current) orderRef.current = ids;
  const [sortingId, setSortingId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [context, setContext] = useState<Position | null>(null);

  const bounds = () => {
    const shell = anchor.current?.closest("#app")?.querySelector<HTMLElement>(".chart-shell");
    const rect = shell?.getBoundingClientRect();
    return {
      left: Math.max(0, rect?.left ?? 0),
      top: Math.max(0, rect?.top ?? 0),
      right: Math.min(window.innerWidth, rect?.right ?? window.innerWidth),
      bottom: Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight),
    };
  };
  const clamp = (next: Position): Position => {
    const area = bounds();
    return {
      left: Math.max(area.left, Math.min(next.left, area.right - (root.current?.offsetWidth ?? 62))),
      top: Math.max(area.top, Math.min(next.top, area.bottom - (root.current?.offsetHeight ?? 38))),
    };
  };
  const move = (next: Position) => { const value = clamp(next); positionRef.current = value; setPosition(value); };
  const clampContext = (next: Position): Position => {
    const area = bounds();
    return { left: Math.max(area.left + 4, Math.min(next.left, area.right - 164)), top: Math.max(area.top + 4, Math.min(next.top, area.bottom - 48)) };
  };
  const openContext = (x: number, y: number) => setContext(clampContext({ left: x, top: y }));

  useEffect(() => {
    const host = () => {
      const workspace = anchor.current?.closest(".chart-workspace") ?? document.getElementById("app");
      const fullscreen = document.fullscreenElement;
      // Giữ lớp nổi trong workspace để kế thừa trạng thái ẩn khi đổi thẻ.
      setPortalHost(fullscreen && (!workspace || fullscreen.contains(workspace) || workspace.contains(fullscreen)) ? fullscreen : workspace ?? document.body);
    };
    host();
    document.addEventListener("fullscreenchange", host);
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
      if (saved && typeof saved.left === "number" && typeof saved.top === "number" && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        preferredPosition.current = saved;
        positionRef.current = saved; setPosition(saved);
      }
    } catch { /* Bỏ qua tọa độ lưu không hợp lệ. */ }
    return () => document.removeEventListener("fullscreenchange", host);
  }, []);

  useEffect(() => {
    if (visible) {
      openedAt.current = performance.now();
      setMounted(true);
      let secondFrame = 0;
      const frame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
    }
    cancelGesture.current();
    setShown(false); setContext(null);
    const timeout = setTimeout(() => setMounted(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : VISIBILITY_DURATION);
    return () => clearTimeout(timeout);
  }, [visible]);

  useLayoutEffect(() => {
    if (gesture.current?.kind === "sort") cancelGesture.current();
    if (!mounted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayIds(ids);
      return;
    }
    // Giữ mục bị xóa đến khi hoàn tất hiệu ứng thu gọn.
    setDisplayIds((current) => {
      const next = [...ids];
      current.forEach((id, index) => {
        if (!ids.includes(id)) next.splice(Math.min(index, next.length), 0, id);
      });
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [ids, mounted]);

  useEffect(() => {
    if (!visible || displayIds.every((id) => ids.includes(id))) return;
    const timeout = setTimeout(() => setDisplayIds((current) => current.filter((id) => idsRef.current.includes(id))), REMOVAL_DURATION + 20);
    return () => clearTimeout(timeout);
  }, [ids, displayIds, visible]);

  useLayoutEffect(() => {
    if (!mounted || !root.current) return;
    const resize = () => {
      const area = bounds();
      if (root.current) {
        root.current.style.maxWidth = `${Math.max(0, area.right - area.left)}px`;
        root.current.style.maxHeight = `${Math.max(0, area.bottom - area.top)}px`;
      }
      const narrow = window.innerWidth < 24 + displayIds.length * 38 && window.innerWidth < window.innerHeight;
      verticalRef.current = narrow; setVertical(narrow);
      move(preferredPosition.current ?? positionRef.current);
      setContext(current => current ? clampContext(current) : current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root.current);
    const shell = anchor.current?.closest("#app")?.querySelector(".chart-shell");
    if (shell) observer.observe(shell);
    resize();
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [mounted, displayIds.length, portalHost]);

  useEffect(() => {
    let clickReset: ReturnType<typeof setTimeout> | undefined;
    const clearLongPress = () => { if (longPress.current) clearTimeout(longPress.current); longPress.current = null; };
    const finish = (cancel: boolean) => {
      clearLongPress();
      const drag = gesture.current;
      gesture.current = null;
      if (!drag) return;
      if (root.current?.hasPointerCapture(drag.pointer)) root.current.releasePointerCapture(drag.pointer);
      if (drag.moved) {
        suppressedClick.current = true;
        if (cancel) { move(drag.origin); orderRef.current = drag.originalOrder; }
        else if (drag.kind === "sort") callbacks.current.onReorder(orderRef.current);
        else {
          preferredPosition.current = positionRef.current;
          try { localStorage.setItem(POSITION_KEY, JSON.stringify(positionRef.current)); } catch { /* Tọa độ vẫn dùng được trong phiên hiện tại. */ }
        }
      }
      clearTimeout(clickReset);
      clickReset = setTimeout(() => { suppressedClick.current = false; }, 0);
      setMoving(false); setPreview(null); setSortingId(null);
    };
    cancelGesture.current = () => finish(true);
    const pointerMove = (event: PointerEvent) => {
      const drag = gesture.current;
      if (!drag || event.pointerId !== drag.pointer) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      clearLongPress();
      if (drag.kind === "sort" && !drag.sortable) return;
      drag.moved = true; suppressedClick.current = true;
      if (!root.current?.hasPointerCapture(event.pointerId)) root.current?.setPointerCapture(event.pointerId);
      event.preventDefault();
      if (drag.kind === "move") {
        setMoving(true); move({ left: drag.origin.left + dx, top: drag.origin.top + dy });
      } else if (drag.toolId) {
        setSortingId(drag.toolId);
        const tools = root.current?.querySelector<HTMLElement>(".favorite-drawing-toolbar__tools");
        const bounds = tools?.getBoundingClientRect();
        if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
        const buttons = Array.from(tools?.querySelectorAll<HTMLButtonElement>("[data-favorite-id]") ?? []).filter((button) => orderRef.current.includes(button.dataset.favoriteId ?? ""));
        const coordinate = verticalRef.current ? event.clientY : event.clientX;
        let target = buttons.findIndex((button) => { const rect = button.getBoundingClientRect(); return coordinate < (verticalRef.current ? rect.top + rect.height / 2 : rect.left + rect.width / 2); });
        if (target < 0) target = buttons.length;
        const originalIndex = orderRef.current.indexOf(drag.toolId);
        if (target > originalIndex) target--;
        const next = orderRef.current.filter((id) => id !== drag.toolId);
        next.splice(target, 0, drag.toolId);
        if (next.some((id, index) => id !== orderRef.current[index])) {
          orderRef.current = next; setPreview(next);
        }
      }
    };
    const pointerUp = (event: PointerEvent) => {
      if (gesture.current?.pointer !== event.pointerId) return;
      finish(event.type === "pointercancel");
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (gesture.current || menu.current) { event.preventDefault(); event.stopPropagation(); }
        finish(true); setContext(null);
      }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setContext(null);
    };
    const blur = () => finish(true);
    window.addEventListener("pointermove", pointerMove, { passive: false });
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("blur", blur);
    document.addEventListener("pointerdown", outside);
    return () => {
      clearLongPress();
      clearTimeout(clickReset);
      const drag = gesture.current;
      gesture.current = null;
      if (drag && root.current?.hasPointerCapture(drag.pointer)) root.current.releasePointerCapture(drag.pointer);
      cancelGesture.current = () => {};
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);

  const start = (event: ReactPointerEvent, kind: Gesture["kind"], toolId?: string) => {
    if (event.button !== 0 || !visible || gesture.current || toolId && !ids.includes(toolId)) return;
    suppressedClick.current = false;
    gesture.current = { pointer: event.pointerId, kind, toolId, startX: event.clientX, startY: event.clientY, origin: positionRef.current, originalOrder: [...ids], moved: false, sortable: event.pointerType === "mouse" };
    orderRef.current = ids;
    if (event.pointerType === "touch") longPress.current = setTimeout(() => { suppressedClick.current = true; openContext(event.clientX, event.clientY); }, 500);
    event.stopPropagation();
  };

  const order = preview ?? displayIds;
  return <><span ref={anchor} hidden />{mounted && portalHost && createPortal(<>
    <div ref={root} className={`favorite-drawing-toolbar ${shown ? "is-open" : "is-closed"} ${vertical ? "is-vertical" : ""} ${moving ? "is-dragging" : ""}`} style={position} role="toolbar" aria-label="Công cụ vẽ yêu thích" aria-hidden={!visible} draggable={false} onDragStart={(event) => event.preventDefault()} onLostPointerCapture={(event) => { if (gesture.current?.pointer === event.pointerId) cancelGesture.current(); }} onContextMenu={(event) => { event.preventDefault(); openContext(event.clientX, event.clientY); }} onClickCapture={(event) => { if (suppressedClick.current || !window.matchMedia("(prefers-reduced-motion: reduce)").matches && performance.now() - openedAt.current < VISIBILITY_DURATION) { event.preventDefault(); event.stopPropagation(); suppressedClick.current = false; } }}>
      <div className="favorite-drawing-toolbar__drag" aria-label="Di chuyển thanh công cụ" onPointerDown={(event) => start(event, "move")} dangerouslySetInnerHTML={{ __html: FAVORITE_ICONS.drag }}/>
      <div className="favorite-drawing-toolbar__tools">{order.map((id) => {
        const tool = TOOLS.get(id);
        if (!tool) return null;
        const removed = !ids.includes(id);
        const removing = visible && removed;
        return <div key={id} className={`favorite-drawing-toolbar__slot${removing ? " is-removing" : ""}`} aria-hidden={removed || undefined} onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === "flex-basis" && !idsRef.current.includes(id)) setDisplayIds((current) => current.filter((value) => value !== id));
        }}><button type="button" tabIndex={-1} draggable={false} data-favorite-id={id} className={`favorite-drawing-toolbar__tool ${id === activeId ? "is-active" : ""} ${sortingId === id ? "is-sorting" : ""}`} aria-label={tool.title} aria-pressed={id === activeId} aria-disabled={!visible || removed || locked || tool.available === false} data-tooltip={removed ? undefined : tool.title} disabled={locked || tool.available === false} onPointerDown={(event) => start(event, "sort", id)} onClick={() => { if (visible && !removed && id !== activeId) onSelect(tool); }} dangerouslySetInnerHTML={{ __html: VNDIRECT_TOOLBAR_ICONS[tool.icon] }}/></div>;
      })}</div>
    </div>
    {context && <div className="favorite-drawing-toolbar__menu" ref={menu} role="menu" style={context}><button type="button" tabIndex={-1} role="menuitem" onClick={() => { callbacks.current.onHide(); setContext(null); }}>Ẩn thanh công cụ</button></div>}
  </>, portalHost)}</>;
}
