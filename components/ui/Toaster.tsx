"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { dismissNotice, getNotices, getServerNotices, subscribeNotices, type Notice } from "../../lib/notifications";
import { Icon } from "../auditor/AuditorUi";
import styles from "./Toaster.module.css";

function Toast({ notice }: { notice: Notice }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ id: number; x: number; time: number } | null>(null);
  const remaining = useRef(notice.duration);
  const paused = hovered || focused || dragging;
  useEffect(() => {
    if (leaving) {
      const timer = setTimeout(() => dismissNotice(notice.id), 180);
      return () => clearTimeout(timer);
    }
    if (paused || drag.current) return;
    const started = Date.now();
    const timer = setTimeout(() => setLeaving(true), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [notice.id, paused, leaving]);
  return <div className={styles.toast} role={notice.kind === "error" ? "alert" : "status"} aria-atomic="true"
    data-kind={notice.kind} data-leaving={leaving} data-dragging={dragging}
    style={{ "--offset": `${offset}px`, "--duration": `${notice.duration}ms` } as CSSProperties}
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setLeaving(true); } }}
    onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest("button,a,input")) return;
      drag.current = { id: event.pointerId, x: event.clientX, time: Date.now() };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => { if (drag.current?.id === event.pointerId) setOffset(event.clientX - drag.current.x); }}
    onPointerUp={event => {
      const started = drag.current;
      if (started?.id !== event.pointerId) return;
      const distance = event.clientX - started.x;
      drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
      if (Math.abs(distance) >= 40 || (Math.abs(distance) > 12 && Math.abs(distance) / Math.max(1, Date.now() - started.time) > .5)) setLeaving(true);
      else setOffset(0);
      setDragging(false); setHovered(event.pointerType === "mouse" && event.currentTarget.matches(":hover"));
    }}
    onPointerCancel={() => { drag.current = null; setOffset(0); setDragging(false); }}>
    <span className={styles.icon}>{notice.kind === "error" ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg> : <Icon name={notice.kind === "success" ? "check" : notice.kind === "info" ? "activity" : "warning"} />}</span>
    <div className={styles.text}><span className={styles.srOnly}>{{ info: "Thông báo", warning: "Cảnh báo", error: "Lỗi", success: "Thành công" }[notice.kind]}: </span>{notice.message}{notice.detail && <div className={styles.detail}>{notice.detail}</div>}</div>
    <button type="button" tabIndex={-1} className={styles.close} aria-label="Đóng thông báo" onClick={() => setLeaving(true)}><Icon name="close" /></button>
    <span className={styles.fuse} style={{ animationPlayState: paused ? "paused" : "running" }} />
  </div>;
}

export default function Toaster() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices, getServerNotices);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const container = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = document.createElement("section");
    element.className = styles.viewport;
    element.setAttribute("aria-label", "Thông báo");
    if (typeof element.showPopover === "function") element.setAttribute("popover", "manual");
    document.body.appendChild(element); container.current = element; setRoot(element);
    return () => { element.remove(); container.current = null; };
  }, []);
  useLayoutEffect(() => {
    const viewport = container.current;
    if (!viewport?.isConnected) return;
    // Popover đặt toast trên dialog và ngoài workspace inert.
    const supportsPopover = typeof viewport.showPopover === "function";
    const place = () => {
      const dialogs = Array.from(document.querySelectorAll("dialog[open]")).filter(dialog => !dialog.closest("[inert]"));
      const parent = dialogs.at(-1) || document.body;
      if (viewport.parentElement !== parent) {
        if (supportsPopover && viewport.matches(":popover-open")) viewport.hidePopover();
        parent.appendChild(viewport);
      }
      viewport.hidden = !notices.length;
      if (supportsPopover) {
        if (notices.length && !viewport.matches(":popover-open")) viewport.showPopover();
        else if (!notices.length && viewport.matches(":popover-open")) viewport.hidePopover();
      }
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "inert"] });
    return () => observer.disconnect();
  }, [root, notices.length]);
  return root ? createPortal(notices.slice(0, 3).map(notice => <Toast key={notice.id} notice={notice} />), root) : null;
}
