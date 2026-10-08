"use client";

import { useLayoutEffect, useRef } from "react";
import { LoadingText } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";

type Option<T> = { value: T; label: string };

export default function AuditorToggleGroup<T extends string>({ label, value, options, disabled: disabledProp = false, loading = false, variant, onChange }: {
  label: string;
  value: T | undefined;
  options: readonly Option<T>[];
  disabled?: boolean;
  loading?: boolean;
  variant: "capture" | "filters";
  onChange: (value: T) => void;
}) {
  const disabled = disabledProp || loading;
  const group = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = group.current;
    const highlight = indicator.current;
    if (!root || !highlight) return;
    highlight.style.removeProperty("visibility");
    const position = () => {
      const selected = root.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) { highlight.style.opacity = "0"; return; }
      const firstPosition = !highlight.dataset.ready;
      if (firstPosition) highlight.style.transition = "none";
      highlight.style.width = `${selected.offsetWidth}px`;
      highlight.style.height = `${selected.offsetHeight}px`;
      highlight.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
      highlight.style.opacity = "1";
      if (firstPosition) {
        // Đặt vị trí ban đầu trước khi bật hiệu ứng chuyển lựa chọn.
        highlight.getBoundingClientRect();
        highlight.style.transition = "";
        highlight.dataset.ready = "true";
      }
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(root);
    root.querySelectorAll("button").forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div ref={group} className={variant === "capture" ? styles.segmented : styles.tabs} role="group" aria-label={label}>
      <span ref={indicator} className={styles.selectionIndicator} aria-hidden="true" />
      {options.map(option => (
        <button key={option.value} type="button" tabIndex={-1} aria-pressed={value === option.value} disabled={disabled} onClick={() => {
          if (option.value !== value) onChange(option.value);
        }}>
          <LoadingText loading={loading} width="auto">{option.label}</LoadingText>
        </button>
      ))}
    </div>
  );
}
