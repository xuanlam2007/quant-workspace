"use client";

import { useEffect, useRef, useState } from "react";

export function ChangeIntervalDialog({ initial, supported, onClose, onChange }: {
  initial: string;
  supported: string[];
  onClose: () => void;
  onChange: (resolution: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const match = /^(\d*)([HDWM]?)$/.exec(value);
  const quantity = Number(match?.[1] || 1);
  const unit = match?.[2] ?? "";
  const resolution = unit === "H" ? String(quantity * 60) : unit ? `${quantity === 1 ? "" : quantity}${unit}` : String(quantity);
  const valid = Boolean(value && match && quantity > 0 && supported.some((item) => item.replace(/^1([DWM])$/, "$1") === resolution));
  const hint = `${quantity} ${unit === "H" ? "giờ" : unit === "D" ? "ngày" : unit === "W" ? "tuần" : unit === "M" ? "tháng" : "phút"}`;
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);
  return <div className="go-to-date-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="change-interval-dialog" role="dialog" aria-modal="true" aria-labelledby="change-interval-title">
      <header><h2 id="change-interval-title">Thay đổi khoảng thời gian</h2><span data-tooltip="Nhập số phút hoặc số cộng H, D, W, M. Ví dụ: 5, 1H, D."><svg viewBox="0 0 18 18" width="18" height="18" fill="none" aria-hidden="true"><path stroke="currentColor" d="M8 8.5h1.5V14"/><circle fill="currentColor" cx="9" cy="5" r="1"/><path stroke="currentColor" d="M16.5 9a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z"/></svg></span></header>
      <form onSubmit={(event) => { event.preventDefault(); if (valid) onChange(resolution); onClose(); }}>
        <input ref={input} tabIndex={-1} value={value} maxLength={8} aria-label="Khoảng thời gian" aria-invalid={!valid} onChange={(event) => setValue(event.target.value.toUpperCase())} />
      </form>
      <div className={valid ? "change-interval-hint" : "change-interval-hint is-error"}>{valid ? hint : "Không áp dụng được"}</div>
    </section>
  </div>;
}
