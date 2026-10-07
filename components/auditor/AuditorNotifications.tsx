"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

export type AuditorNotification = { id: number; kind: "success" | "error"; text: string };

function Notification({ notice, onDismiss }: { notice: AuditorNotification; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(5000);
  const element = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.current?.animate([
      { transform: "translateY(6px)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ], { duration: 180, easing: "ease-out" });
    return () => animation?.cancel();
  }, []);

  useEffect(() => {
    if (leaving) {
      const timeout = setTimeout(() => onDismiss(notice.id), 140);
      return () => clearTimeout(timeout);
    }
    if (hovered || focused) return;
    const started = Date.now();
    const timeout = setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      clearTimeout(timeout);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [notice.id, onDismiss, hovered, focused, leaving]);

  return (
    <div
      ref={element}
      className={styles.toast}
      data-kind={notice.kind}
      data-leaving={leaving}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <span className={styles.toastIcon}><Icon name={notice.kind === "error" ? "warning" : "check"} /></span>
      <p>{notice.text}</p>
      <button type="button" tabIndex={-1} className={styles.toastDismiss} aria-label="Đóng thông báo" onClick={() => setLeaving(true)}><Icon name="close" /></button>
    </div>
  );
}

export default function AuditorNotifications({ notices, onDismiss, modalId }: { notices: AuditorNotification[]; onDismiss: (id: number) => void; modalId?: string }) {
  const container = useRef<HTMLElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const hasNotices = notices.length > 0;

  useLayoutEffect(() => {
    const root = document.createElement("section");
    container.current = root;
    root.className = styles.notificationViewport;
    root.lang = "vi";
    root.setAttribute("aria-label", "Thông báo");
    if (typeof root.showPopover === "function") root.setAttribute("popover", "manual");
    else root.dataset.fallback = "true";
    document.body.appendChild(root);
    setPortalRoot(root);
    return () => {
      if (typeof root.hidePopover === "function" && root.matches(":popover-open")) root.hidePopover();
      root.remove();
      container.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const supportsPopover = typeof root.showPopover === "function";
    const hide = () => {
      if (supportsPopover && root.matches(":popover-open")) root.hidePopover();
    };
    const place = () => {
      const dialog = modalId ? document.getElementById(modalId) : null;
      const parent = dialog || document.body;
      // Giữ nguyên đích portal để trạng thái và bộ đếm không bị khởi tạo lại.
      if (root.parentElement !== parent) {
        hide();
        parent.appendChild(root);
      }
      root.hidden = !hasNotices || (dialog instanceof HTMLDialogElement && !dialog.open);
      if (root.hidden) hide();
      else if (supportsPopover && !root.matches(":popover-open")) root.showPopover();
    };
    place();
    const dialog = modalId ? document.getElementById(modalId) : null;
    if (!hasNotices || !(dialog instanceof HTMLDialogElement)) return;
    const observer = new MutationObserver(place);
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [modalId, hasNotices]);

  if (!portalRoot) return null;
  return createPortal(
    <>
      {notices.map(notice => <Notification key={notice.id} notice={notice} onDismiss={onDismiss} />)}
    </>,
    portalRoot,
  );
}
