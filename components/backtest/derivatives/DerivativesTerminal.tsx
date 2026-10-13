import { useMemo, useState, type ReactNode } from "react";
import type { PaperLedger, PaperOrder, ReplayData, ReplayFrame } from "../../../lib/backtest";
import type { DerivativeTicket } from "../../../lib/derivatives-ledger";
import { replayMarketAt } from "../../../lib/derivatives-market";
import { AccountPanel } from "./AccountPanel";
import { MarketPanel, VolumeProfile } from "./MarketPanel";
import { OrderTicket } from "./OrderTicket";
import { emptyTicket, ticketFromOrder, type TicketDraft } from "../../../lib/derivatives-ticket";
import { QuickTrade } from "./QuickTrade";
import styles from "./DerivativesTerminal.module.css";

export function DerivativesTerminal({ data, frame, ledger, chart, onOrder, onCancel, onPosition }: {
  data: ReplayData | null; frame: ReplayFrame | null; ledger: PaperLedger; chart: ReactNode;
  onOrder: (ticket: DerivativeTicket, replacing?: string) => boolean;
  onCancel: (ids: string[]) => void; onPosition: (reverse: boolean) => void;
}) {
  const symbol = data?.symbol ?? "VN30F1M", cutoff = frame?.cutoff ?? 0;
  const [draft, setDraft] = useState<TicketDraft>(() => emptyTicket(cutoff));
  const [editingId, setEditingId] = useState<string>();
  const [accountTab, setAccountTab] = useState("orders");
  const [orderView, setOrderView] = useState({ revision: 0, conditional: false });
  const market = useMemo(() => replayMarketAt(data?.market, cutoff), [data?.market, cutoff]);
  const last = frame?.bars.at(-1)?.close;
  const editing = ledger.orders.find(order => order.id === editingId);
  const submit = (ticket: DerivativeTicket, quick = false) => {
    const success = onOrder(ticket, quick ? undefined : editingId);
    if (success) {
      setEditingId(undefined); setAccountTab("orders");
      setOrderView(previous => ({ revision: previous.revision + 1, conditional: ticket.kind !== "normal" }));
      if (quick) setDraft(emptyTicket(cutoff));
    }
    return success;
  };
  const selectPrice = (price: number) => {
    setDraft(previous => ({ ...previous, price: String(Math.round(price * 10) / 10), expiry: previous.expiry || emptyTicket(cutoff).expiry }));
    document.getElementById("derivative-quantity")?.focus({ preventScroll: true });
  };
  const edit = (order: PaperOrder) => { setEditingId(order.id); setDraft(ticketFromOrder(order)); };
  return <div className={styles.terminal} data-derivatives-terminal onKeyDown={event => { if (event.key === "Tab") event.preventDefault(); }}>
    <div className={styles.chartColumn}><div className={styles.chart}>{chart}{!!frame?.bars.length && <QuickTrade ledger={ledger} quote={market.quote} last={last} onOrder={ticket => submit(ticket, true)} />}</div><VolumeProfile symbol={symbol} trades={market.trades} onPrice={selectPrice} /></div>
    <MarketPanel symbol={symbol} frame={frame} quote={market.quote} trades={market.trades} onPrice={selectPrice} />
    <div className={styles.rightColumn}><OrderTicket symbol={symbol} cutoff={cutoff} ledger={ledger} draft={draft} onChange={setDraft} onOrder={ticket => submit(ticket)} editing={editing} onCancelEdit={() => { setEditingId(undefined); setDraft(emptyTicket(cutoff)); }} /><AccountPanel key={orderView.revision} initialConditional={orderView.conditional} symbol={symbol} ledger={ledger} last={last} tab={accountTab} onTab={setAccountTab} onCancel={onCancel} onEdit={edit} onPosition={onPosition} /></div>
  </div>;
}
