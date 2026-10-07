"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorFormula({ feePerPair = 0.45 }: { feePerPair?: number }) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const visible = open;
  const fee = String(feePerPair).replace(".", ",");
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const button = trigger.current?.getBoundingClientRect();
      const panel = tooltip.current;
      if (!button || !panel) return;
      const bounds = panel.getBoundingClientRect();
      const left = Math.max(12, Math.min(button.right - bounds.width, window.innerWidth - bounds.width - 12));
      const below = button.bottom + 8;
      const top = below + bounds.height <= window.innerHeight - 12 ? below : Math.max(12, button.top - bounds.height - 8);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    place();
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); if (closeTimer.current) clearTimeout(closeTimer.current); } };
    const observer = new ResizeObserver(place);
    if (tooltip.current) observer.observe(tooltip.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [visible]);

  return <div ref={wrapper} className={styles.formulaControl}
    onPointerEnter={event => { if (event.pointerType !== "touch") { cancelClose(); setOpen(true); } }}
    onPointerLeave={event => { if (event.pointerType !== "touch") { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 150); } }}
    onFocusCapture={() => { cancelClose(); setOpen(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { cancelClose(); setOpen(false); } }}>
    <button ref={trigger} type="button" tabIndex={-1} className={styles.formulaTrigger} aria-label="Công thức tính điểm" aria-expanded={visible} aria-describedby={visible ? id : undefined}
      onClick={() => { cancelClose(); setOpen(true); }}>Σ</button>
    {visible && <div ref={tooltip} id={id} className={styles.formulaTooltip} role="tooltip">
      <strong>Công thức tính điểm</strong>
      <div className={styles.formulaScroll}>
        <div className={styles.equation} role="math" aria-label="Điểm chưa trừ phí bằng tổng từ i bằng 1 đến N của giá SELL trừ giá BUY của cặp thứ i.">
          <span aria-hidden="true">Điểm chưa trừ phí =</span>
          <span className={styles.sigma} aria-hidden="true"><span>N</span><span>∑</span><span>i = 1</span></span>
          <span aria-hidden="true">(P<sub className={styles.negative}>đỏ,i</sub> − P<sub className={styles.positive}>xanh,i</sub>)</span>
        </div>
        <div className={styles.equation} role="math" aria-label={`Điểm sau trừ phí bằng điểm chưa trừ phí trừ ${fee} nhân N.`}>
          <span aria-hidden="true">Điểm sau trừ phí = Điểm chưa trừ phí − {fee} × N</span>
        </div>
      </div>
      <p className={styles.help}>N là số cặp lệnh đã đóng, mỗi cặp tương ứng một hợp đồng. P<sub className={styles.negative}>đỏ,i</sub> là giá SELL và P<sub className={styles.positive}>xanh,i</sub> là giá BUY của cặp thứ i.</p>
      <p className={styles.help}>Phí {fee} điểm/cặp chỉ áp dụng khi cặp lệnh đã đóng. Lệnh giả lập không được tính vào N.</p>
    </div>}
  </div>;
}
