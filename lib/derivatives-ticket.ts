import type { PaperOrder } from "./backtest";
import type { DerivativeTicket } from "./derivatives-ledger";

export type TicketDraft = { kind: DerivativeTicket["kind"]; price: string; quantity: string; trigger: string; relation: "lte" | "gte"; amount: string; spread: string; expiry: string; bracketMode: "price" | "points"; stopTrigger: string; stopLimit: string; takeTrigger: string; takeLimit: string };
export const emptyTicket = (cutoff: number): TicketDraft => ({ kind: "normal", price: "", quantity: "", trigger: "", relation: "lte", amount: "", spread: "", expiry: new Date((cutoff + 7 * 3600) * 1000).toISOString().slice(0, 10), bracketMode: "price", stopTrigger: "", stopLimit: "", takeTrigger: "", takeLimit: "" });
export function ticketFromOrder(order: PaperOrder): TicketDraft {
  return { ...emptyTicket(order.expires ?? order.submitted), kind: order.strategy ?? (order.type === "STOP_LIMIT" ? "stop" : "normal"), price: String(order.trailing?.anchor ?? order.limit ?? order.price ?? ""), quantity: String(order.quantity ?? 1), trigger: String(order.stop ?? ""), relation: order.relation ?? (order.side === "BUY" ? "gte" : "lte"), amount: String(order.trailing?.amount ?? ""), spread: String(order.trailing?.spread ?? ""), stopTrigger: String(order.bracket?.stopTrigger ?? ""), stopLimit: String(order.bracket?.stopLimit ?? ""), takeTrigger: String(order.bracket?.takeTrigger ?? ""), takeLimit: String(order.bracket?.takeLimit ?? "") };
}
export function ticketOrder(draft: TicketDraft, side: "BUY" | "SELL"): DerivativeTicket {
  const price = Number(draft.price), direction = side === "BUY" ? 1 : -1;
  const points = draft.bracketMode === "points";
  const stopTrigger = points ? price - direction * Number(draft.stopTrigger) : Number(draft.stopTrigger);
  const takeTrigger = points ? price + direction * Number(draft.takeTrigger) : Number(draft.takeTrigger);
  return { side, kind: draft.kind, quantity: Number(draft.quantity), price, trigger: Number(draft.trigger), ...(draft.kind === "stop" ? { relation: draft.relation } : {}),
    ...(draft.kind === "stop" ? { expires: Date.parse(`${draft.expiry}T23:59:59+07:00`) / 1000 } : {}),
    amount: Number(draft.amount), spread: Number(draft.spread),
    ...(draft.kind === "oco" ? { bracket: { stopTrigger, stopLimit: points ? stopTrigger - direction * Number(draft.stopLimit) : Number(draft.stopLimit), takeTrigger, takeLimit: points ? takeTrigger + direction * Number(draft.takeLimit) : Number(draft.takeLimit) } } : {}),
  };
}

