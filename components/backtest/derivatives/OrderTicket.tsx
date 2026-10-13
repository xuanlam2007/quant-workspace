import { useState } from "react";
import { ChartSelect } from "../../chart/ui/ChartSelect";
import type { PaperLedger, PaperOrder } from "../../../lib/backtest";
import { availableContracts, type DerivativeTicket } from "../../../lib/derivatives-ledger";
import { DerivativeIcon, NumberStepper } from "./DerivativeControls";
import styles from "./DerivativesTerminal.module.css";

import { emptyTicket, ticketOrder, type TicketDraft } from "../../../lib/derivatives-ticket";

export function OrderTicket({ symbol, cutoff, ledger, draft, onChange, onOrder, editing, onCancelEdit }: { symbol: string; cutoff: number; ledger: PaperLedger; draft: TicketDraft; onChange: (draft: TicketDraft) => void; onOrder: (ticket: DerivativeTicket) => boolean; editing?: PaperOrder; onCancelEdit: () => void }) {
  const [refresh, setRefresh] = useState(0);
  const update = (key: keyof TicketDraft, value: string) => onChange({ ...draft, [key]: value });
  const submit = (side: "BUY" | "SELL") => { if (onOrder(ticketOrder(draft, side))) onChange(emptyTicket(cutoff)); };
  const row = (label: string, field: "price" | "quantity" | "amount" | "spread" | "stopTrigger" | "stopLimit" | "takeTrigger" | "takeLimit", step = .1) => <div className={styles.field}><span>{label}</span><NumberStepper label={label} value={draft[field]} step={step} onChange={value => update(field, value)} /></div>;
  const today = new Date((cutoff + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const lastDay = new Date((cutoff + 30 * 86400 + 7 * 3600) * 1000).toISOString().slice(0, 10);
  return <section className={styles.ticket} aria-label="Đặt lệnh phái sinh mô phỏng">
    <div className={styles.accountSelect}><ChartSelect id="derivative-account" label="Tài khoản mô phỏng" value="paper" onChange={() => {}} options={[{ value: "paper", label: "(P) BACKTEST - TÀI KHOẢN MÔ PHỎNG" }]} /></div>
    <div className={styles.field}><span>Mã hợp đồng</span><ChartSelect id="derivative-symbol" label="Mã hợp đồng" value={symbol} onChange={() => {}} options={[{ value: symbol, label: symbol }]} /></div>
    <div className={styles.field}><span>Long-short tối đa</span><div className={styles.capacity}><span><b className={styles.up}>{availableContracts(ledger, "BUY")}</b> (HĐ)</span><span>-</span><span><b className={styles.down}>{availableContracts(ledger, "SELL")}</b> (HĐ)</span><button type="button" tabIndex={-1} title="Làm mới giới hạn mô phỏng 1.000 hợp đồng theo vị thế và lệnh chờ" onClick={() => setRefresh(value => value + 1)}><span key={refresh} className={refresh ? styles.refreshing : undefined}><DerivativeIcon name="refresh" /></span></button></div></div>
    <div className={styles.field}><span>Loại lệnh</span><ChartSelect<DerivativeTicket["kind"]> id="derivative-kind" label="Loại lệnh" value={draft.kind} onChange={kind => onChange({ ...emptyTicket(cutoff), kind })} options={[{ value: "normal", label: "Thường" }, { value: "stop", label: "Stop Limit" }, { value: "trailing", label: "Trailing Stop" }, { value: "oco", label: "OCO" }]} /></div>
    {draft.kind === "stop" && <div className={styles.field}><span>Giá kích hoạt</span><div className={styles.trigger}><button type="button" tabIndex={-1} aria-pressed={draft.relation === "lte"} onClick={() => update("relation", "lte")} aria-label="Giá nhỏ hơn hoặc bằng">≤</button><button type="button" tabIndex={-1} aria-pressed={draft.relation === "gte"} onClick={() => update("relation", "gte")} aria-label="Giá lớn hơn hoặc bằng">≥</button><input tabIndex={-1} aria-label="Giá kích hoạt" inputMode="decimal" placeholder="0" value={draft.trigger} onChange={event => { if (/^\d*(?:\.\d?)?$/.test(event.target.value)) update("trigger", event.target.value); }} /></div></div>}
    {row(draft.kind === "trailing" ? "Giá kích hoạt ban đầu" : "Giá đặt", "price")}
    {draft.kind === "normal" && <div className={styles.priceTypes}>{["ATO", "ATC", "MTL", "MAK", "MOK"].map(type => <span key={type} title={`${type} cần phiên khớp lệnh và thanh khoản thực. Dữ liệu OHLC chưa hỗ trợ mô phỏng chính xác.`}><button type="button" tabIndex={-1} disabled>{type}</button></span>)}</div>}
    {draft.kind === "trailing" && <>{row("Bước giá trượt", "amount")}{row("Biên độ giá đặt", "spread")}<p className={styles.note}>Giá kích hoạt dịch theo cực trị giá đã replay; sau kích hoạt, xét khớp Limit từ mẫu tiếp theo.</p></>}
    <div className={styles.field}><span>Khối lượng</span><div><NumberStepper label="Khối lượng" step={1} value={draft.quantity} onChange={value => update("quantity", value)} /></div></div>
    {draft.kind === "stop" && <div className={styles.field}><label htmlFor="derivative-expiry">Ngày hết hạn</label><input id="derivative-expiry" tabIndex={-1} type="date" min={today} max={lastDay} value={draft.expiry} onChange={event => update("expiry", event.target.value)} /></div>}
    {draft.kind === "oco" && <div className={styles.bracket}>
      <div className={styles.modeTabs}><button type="button" tabIndex={-1} aria-pressed={draft.bracketMode === "price"} onClick={() => update("bracketMode", "price")}>Theo giá</button><button type="button" tabIndex={-1} aria-pressed={draft.bracketMode === "points"} onClick={() => update("bracketMode", "points")}>Theo điểm</button></div>
      <strong>Điều kiện cắt lỗ</strong>{row(draft.bracketMode === "points" ? "Điểm kích hoạt cắt lỗ" : "Giá kích hoạt cắt lỗ", "stopTrigger")}{row(draft.bracketMode === "points" ? "Điểm đặt cắt lỗ" : "Giá đặt cắt lỗ", "stopLimit")}
      <strong>Điều kiện chốt lãi</strong>{row(draft.bracketMode === "points" ? "Điểm kích hoạt chốt lãi" : "Giá kích hoạt chốt lãi", "takeTrigger")}{row(draft.bracketMode === "points" ? "Điểm đặt chốt lãi" : "Giá đặt chốt lãi", "takeLimit")}
    </div>}
    {editing ? <div className={styles.editActions}><button type="button" tabIndex={-1} onClick={onCancelEdit}>Quay lại</button><button type="button" tabIndex={-1} className={styles.orangeButton} onClick={() => submit(editing.side)}>Sửa lệnh {editing.id}</button></div> : <div className={styles.tradeButtons}><button type="button" tabIndex={-1} className={styles.longButton} disabled={!cutoff} onClick={() => submit("BUY")}>LONG</button><button type="button" tabIndex={-1} className={styles.shortButton} disabled={!cutoff} onClick={() => submit("SELL")}>SHORT</button></div>}
  </section>;
}

