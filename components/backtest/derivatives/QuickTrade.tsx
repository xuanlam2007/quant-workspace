import { useEffect, useRef, useState, type PointerEvent } from "react";
import { availableContracts, type DerivativeTicket } from "../../../lib/derivatives-ledger";
import type { PaperLedger } from "../../../lib/backtest";
import type { ReplayQuote } from "../../../lib/derivatives-market";
import { DerivativeIcon, formatPrice, priceClass } from "./DerivativeControls";
import styles from "./DerivativesTerminal.module.css";

export function QuickTrade({ ledger, quote, last, onOrder }: { ledger: PaperLedger; quote: ReplayQuote | null; last?: number; onOrder: (ticket: DerivativeTicket) => boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [position, setPosition] = useState({ x: 56, y: 175 });
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const clamp = (x: number, y: number) => {
    const panel = element.current;
    const parent = panel?.parentElement;
    return { x: Math.max(0, Math.min(x, (parent?.clientWidth ?? 0) - (panel?.offsetWidth ?? 0))), y: Math.max(0, Math.min(y, (parent?.clientHeight ?? 0) - (panel?.offsetHeight ?? 0))) };
  };
  useEffect(() => {
    const panel = element.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const observer = new ResizeObserver(() => setPosition(previous => {
      const next = { x: Math.max(0, Math.min(previous.x, parent.clientWidth - panel.offsetWidth)), y: Math.max(0, Math.min(previous.y, parent.clientHeight - panel.offsetHeight)) };
      return next.x === previous.x && next.y === previous.y ? previous : next;
    }));
    observer.observe(parent); observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: position.x, top: position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current?.pointer === event.pointerId) setPosition(clamp(current.left + event.clientX - current.x, current.top + event.clientY - current.y));
  };
  const submit = (side: "BUY" | "SELL") => {
    const price = (side === "BUY" ? quote?.asks[0]?.price : quote?.bids[0]?.price) ?? last;
    if (onOrder({ side, kind: "normal", price: Math.round((price ?? 0) * 10) / 10, quantity: Number(quantity) })) setQuantity("");
  };
  const tooltip = quote ? "Giá đặt lệnh sẽ lấy theo giá cập nhật gần nhất của thị trường" : "Giá đặt lệnh mô phỏng lấy theo giá đóng mẫu vừa mở. Chưa có dữ liệu dư mua, dư bán.";
  return <div ref={element} className={styles.quickTrade} style={{ left: position.x, top: position.y }} data-collapsed={collapsed} aria-label="Đặt lệnh nhanh mô phỏng">
    <div className={styles.quickHandle}>
      <button type="button" tabIndex={-1} aria-label={collapsed ? "Mở đặt lệnh nhanh" : "Thu gọn đặt lệnh nhanh"} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)} className={collapsed ? styles.flip : undefined}><DerivativeIcon name="collapse" /></button>
      <button type="button" tabIndex={-1} className={styles.dragHandle} aria-label="Di chuyển bảng đặt lệnh" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><DerivativeIcon name="drag" /></button>
    </div>
    {!collapsed && <div className={styles.quickBody}>
      <button type="button" tabIndex={-1} className={styles.quickSide} disabled={!last} title={tooltip} onClick={() => submit("BUY")}><span className={styles.up}>LONG</span><strong className={priceClass(quote?.asks[0]?.price ?? last, quote?.reference)}>{formatPrice(quote?.asks[0]?.price ?? last)}</strong><small title="Giới hạn mô phỏng 1.000 hợp đồng mỗi chiều">KL max: {availableContracts(ledger, "BUY")}</small></button>
      <div className={styles.quickQuantity}><input tabIndex={-1} aria-label="Khối lượng đặt lệnh nhanh" placeholder="KL" inputMode="numeric" value={quantity} onChange={event => { if (/^\d*$/.test(event.target.value)) setQuantity(event.target.value); }} /><div><button type="button" tabIndex={-1} aria-label="Giảm khối lượng đặt lệnh nhanh" onClick={() => setQuantity(String(Math.max(0, Number(quantity) - 1)))}><DerivativeIcon name="quickMinus" /></button><button type="button" tabIndex={-1} aria-label="Tăng khối lượng đặt lệnh nhanh" onClick={() => setQuantity(String(Number(quantity) + 1))}><DerivativeIcon name="quickPlus" /></button></div></div>
      <button type="button" tabIndex={-1} className={styles.quickSide} disabled={!last} title={tooltip} onClick={() => submit("SELL")}><span className={styles.down}>SHORT</span><strong className={priceClass(quote?.bids[0]?.price ?? last, quote?.reference)}>{formatPrice(quote?.bids[0]?.price ?? last)}</strong><small title="Giới hạn mô phỏng 1.000 hợp đồng mỗi chiều">KL max: {availableContracts(ledger, "SELL")}</small></button>
    </div>}
  </div>;
}
