"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PRICE_AXIS_ICONS } from "./price-axis-icons";
import { menuIcons } from "../symbols/MarketDataPanel";

export type ChartMenuPosition = { x: number; y: number; price: number | null; time: number | null; paneIndex: number };
export type ChartMenuAction = "reset" | "copy" | "paste" | "lock" | "drawings" | "indicators" | "marks" | "settings";

export function ChartContextMenu({ position, precision, locked, marksHidden, hasDrawings, onAction, onClose }: {
  position: ChartMenuPosition;
  precision: number;
  locked: boolean;
  marksHidden: boolean;
  hasDrawings: boolean;
  onAction: (action: ChartMenuAction) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const element = root.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
      element.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [position]);
  useEffect(() => {
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => {
      if (((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") || (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "r")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onAction(event.altKey ? "reset" : "paste");
        onClose();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") event.preventDefault();
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose, onAction]);
  const item = (action: ChartMenuAction, label: string, options: { icon?: "reset" | "settings"; shortcut?: string; checked?: boolean; disabled?: boolean } = {}) => (
    <button type="button" tabIndex={-1} role={options.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={options.checked} disabled={options.disabled} className="series-menu__item"
      onClick={() => { onAction(action); onClose(); }}>
      <span className="series-menu__icon">{options.icon === "reset" ? PRICE_AXIS_ICONS.reset : options.icon === "settings" ? menuIcons.settings : options.checked ? PRICE_AXIS_ICONS.check : null}</span>
      <span className="series-menu__label">{label}</span>
      {options.shortcut && <span className="series-menu__shortcut">{options.shortcut}</span>}
    </button>
  );
  const divider = <div className="series-menu__divider" role="separator" />;
  return createPortal(<div ref={root} className="series-menu chart-context-menu" role="menu" aria-label="Tùy chọn biểu đồ"
    style={{ left: position.x, top: position.y, visibility: "hidden" }} onContextMenu={(event) => event.preventDefault()}>
    {item("reset", "Đặt lại chế độ xem biểu đồ", { icon: "reset", shortcut: "Alt + R" })}
    {divider}
    {item("copy", `Sao chép giá${position.price === null ? "" : ` ${position.price.toFixed(precision)}`}`, { disabled: position.price === null })}
    {item("paste", "Dán", { shortcut: "Ctrl + V" })}
    {divider}
    {item("lock", "Khóa dòng con trỏ dọc theo thời gian", { checked: locked, disabled: !locked && (position.time === null || position.price === null) })}
    {divider}
    {item("drawings", "Bỏ Công cụ vẽ", { disabled: !hasDrawings })}
    {item("indicators", "Bỏ đi các Chỉ số")}
    {divider}
    {item("marks", "Ẩn các Điểm trên Thanh", { checked: marksHidden })}
    {divider}
    {item("settings", "Cài đặt…", { icon: "settings" })}
  </div>, document.fullscreenElement ?? document.body);
}
