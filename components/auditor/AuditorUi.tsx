"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { TerminalHost } from "../../lib/auditor-client";
import { LoadingText } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";

type IconName = "activity" | "terminal" | "history" | "plus" | "close" | "check" | "chevron" | "refresh" | "capture" | "export" | "back" | "warning" | "play" | "pause" | "stop";
const paths: Record<IconName, ReactNode> = {
  play: <path d="m8 4 12 8-12 8V4Z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1" />,
  pause: <><path d="M7 4h3v16H7zM14 4h3v16h-3z" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  refresh: <path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5" />,
  capture: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4M9 9h6v4H9z" /></>,
  export: <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />,
  back: <path d="m12 5-7 7 7 7M5 12h15" />,
  warning: <path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01" />,
};
export function Icon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
const hosts: { value: TerminalHost; label: string }[] = [
  { value: "ORCA", label: "Orca Terminal" }, { value: "WINDOWS", label: "Windows Console Host" }, { value: "WT", label: "Windows Terminal" }, { value: "NONE", label: "Không sử dụng" },
];
export function TerminalSelect({ value, disabled, loading = false, onChange }: { value: TerminalHost; disabled: boolean; loading?: boolean; onChange: (value: TerminalHost) => void }) {
  return <AuditorSelect id="auditor-terminal" label="Loại Terminal" icon="terminal" value={value} options={hosts} disabled={disabled || loading} loading={loading} onChange={onChange} />;
}

type SelectOption<T> = { value: T; label: string; disabled?: boolean };

export function AuditorSelect<T extends string | number>({ id, label, icon, value, options, disabled: disabledProp, loading = false, onChange }: {
  id: string;
  label: string;
  icon: IconName;
  value: T;
  options: SelectOption<T>[];
  disabled: boolean;
  loading?: boolean;
  onChange: (value: T) => void;
}) {
  const disabled = disabledProp || loading;
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: false, height: 280 });
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", time: 0 });
  const selected = options.find(option => option.value === value);

  useLayoutEffect(() => {
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 24;
      const above = rect.top - 24;
      const upwards = below < Math.min(280, options.length * 38 + 12) && above > below;
      setPlacement({ above: upwards, height: Math.max(80, Math.min(280, upwards ? above : below)) });
    };
    place();
    const menu = container.current;
    const option = menu?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)') || menu?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, value, disabled, options.length]);

  return (
    <div className={styles.select} ref={container} onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (event.key === "Tab" && open) {
        trigger.current?.focus({ preventScroll: true });
        setOpen(false);
      }
      const buttons = Array.from(container.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!open) { setOpen(true); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
        buttons[next]?.scrollIntoView({ block: "nearest" });
      } else if (open && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        search.current.text = now - search.current.time > 700 ? event.key : search.current.text + event.key;
        search.current.time = now;
        const prefix = search.current.text.toLocaleLowerCase();
        const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
        const match = ordered.find(button => button.textContent?.toLocaleLowerCase().startsWith(prefix));
        match?.focus({ preventScroll: true });
        match?.scrollIntoView({ block: "nearest" });
      }
    }}>
      <button
        id={id}
        ref={trigger}
        type="button"
        className={styles.button}
        disabled={disabled}
        aria-label={`${label}: ${selected?.label || "Chưa chọn"}`}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={`${id}-options`}
        title={selected?.label}
        onClick={() => setOpen(previous => !previous)}
      >
        <Icon name={icon} /><span><LoadingText width="100%" loading={loading} label={`Đang tải ${label}`}>{selected?.label || "Chọn..."}</LoadingText></span><Icon name="chevron" />
      </button>
      {open && !disabled && (
        <div className={styles.menu} id={`${id}-options`} role="listbox" aria-label={label} data-placement={placement.above ? "top" : "bottom"} style={{ maxHeight: placement.height }}>
          {options.map(option => (
            <button key={option.value} type="button" role="option" aria-selected={value === option.value} disabled={option.disabled} tabIndex={-1} title={option.label} onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              if (option.value !== value) onChange(option.value);
            }}>
              <span>{option.label}</span>{value === option.value && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export const points = (value: number | undefined, signed = false) => value === undefined ? "N/A" : `${signed && value > 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
