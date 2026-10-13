import type { PaperLedger, PaperOrder, ReplayData } from "./backtest";

export type DerivativeTicket = {
  side: "BUY" | "SELL"; kind: "normal" | "stop" | "trailing" | "oco";
  quantity: number; price: number; market?: boolean; trigger?: number;
  relation?: "gte" | "lte"; expires?: number; amount?: number; spread?: number;
  bracket?: PaperOrder["bracket"]; reduceOnly?: boolean;
};
export const pendingOrder = (order: PaperOrder) => order.status === "waiting" || order.status === "triggered";
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const rounded = (n: number) => Math.round(n * 10) / 10;

export function availableContracts(ledger: PaperLedger, side: "BUY" | "SELL", maximum = 1000) {
  const signed = ledger.position ? (ledger.position.quantity ?? 1) * (ledger.position.side === "LONG" ? 1 : -1) : 0;
  const pending = ledger.orders.filter(order => pendingOrder(order) && order.side === side && !order.parent).reduce((sum, order) => sum + (order.quantity ?? 1), 0);
  return Math.max(0, maximum - (side === "BUY" ? signed : -signed) - pending);
}

export function submitDerivativeOrder(ledger: PaperLedger, ticket: DerivativeTicket, cutoff: number): PaperLedger {
  if (!Number.isInteger(ticket.quantity) || ticket.quantity < 1 || ticket.quantity > 1000) throw new Error("Khối lượng phải từ 1 đến 1.000 hợp đồng.");
  if (!Number.isInteger(cutoff) || cutoff < 0) throw new Error("Thời điểm replay không hợp lệ.");
  if (!positive(ticket.price) || Math.abs(ticket.price * 10 - Math.round(ticket.price * 10)) > 1e-7) throw new Error("Giá đặt phải lớn hơn 0, bước giá 0,1.");
  if (ledger.orders.length + ledger.orders.filter(order => pendingOrder(order) && order.bracket).length * 2 + (ticket.kind === "oco" ? 3 : 1) > 300) throw new Error("Đã đạt giới hạn lệnh của lượt replay. Xuất kết quả và bắt đầu lượt mới.");
  if (ticket.market && ticket.kind !== "normal") throw new Error("Lệnh thị trường không hỗ trợ điều kiện kèm theo.");
  if (ticket.quantity > availableContracts(ledger, ticket.side)) throw new Error("Khối lượng vượt giới hạn vị thế mô phỏng.");
  if (ticket.reduceOnly && (!ledger.position || ticket.side === (ledger.position.side === "LONG" ? "BUY" : "SELL") || ticket.quantity > (ledger.position.quantity ?? 1))) throw new Error("Khối lượng đóng vượt vị thế hiện tại.");
  if (ticket.expires !== undefined && (!Number.isInteger(ticket.expires) || ticket.expires <= cutoff || ticket.expires > cutoff + 31 * 86400)) throw new Error("Ngày hết hạn phải sau thời điểm replay.");
  if (ticket.kind === "stop" && !positive(ticket.trigger)) throw new Error("Giá kích hoạt phải lớn hơn 0.");
  if (ticket.kind === "trailing" && (!positive(ticket.amount) || !Number.isFinite(ticket.spread) || ticket.spread! < 0)) throw new Error("Nhập bước giá trượt dương và biên độ không âm.");
  if (ticket.kind === "oco") {
    const bracket = ticket.bracket;
    if (!bracket || !Object.values(bracket).every(positive)) throw new Error("Nhập đủ giá kích hoạt và giá đặt của hai nhánh OCO.");
    const buy = ticket.side === "BUY";
    if (!(buy ? bracket.stopTrigger < ticket.price && bracket.takeTrigger > ticket.price && bracket.stopLimit <= bracket.stopTrigger : bracket.stopTrigger > ticket.price && bracket.takeTrigger < ticket.price && bracket.stopLimit >= bracket.stopTrigger)) throw new Error("Giá cắt lỗ, chốt lời hoặc giá đặt OCO không hợp lệ với chiều lệnh.");
  }
  const direction = ticket.side === "BUY" ? 1 : -1;
  const stop = ticket.kind === "trailing" ? rounded(ticket.price + direction * ticket.amount!) : ticket.kind === "stop" ? ticket.trigger! : null;
  const limit = ticket.market ? null : ticket.kind === "trailing" ? rounded(stop! + direction * ticket.spread!) : ticket.price;
  if (stop !== null && !positive(stop) || limit !== null && !positive(limit)) throw new Error("Giá kích hoạt hoặc giá đặt phải lớn hơn 0.");
  const order: PaperOrder = {
    id: `order-${ledger.orders.length + 1}`, side: ticket.side, purpose: ticket.reduceOnly ? "CLOSE" : "OPEN",
    type: ticket.market ? "MARKET" : ["stop", "trailing"].includes(ticket.kind) ? "STOP_LIMIT" : "LIMIT",
    stop, limit, submitted: cutoff, triggered: null, filled: null, price: null, status: "waiting",
    quantity: ticket.quantity, strategy: ticket.kind,
    ...(ticket.relation ? { relation: ticket.relation } : {}), ...(ticket.expires ? { expires: ticket.expires } : {}),
    ...(ticket.kind === "trailing" ? { trailing: { amount: ticket.amount!, spread: ticket.spread!, anchor: ticket.price } } : {}),
    ...(ticket.kind === "oco" ? { bracket: { ...ticket.bracket! } } : {}),
  };
  return { ...ledger, orders: [...ledger.orders, order] };
}

export function cancelDerivativeOrders(ledger: PaperLedger, ids: string[]) {
  const selected = new Set(ids);
  return { ...ledger, orders: ledger.orders.map(order => selected.has(order.id) && pendingOrder(order) ? { ...order, status: "cancelled" as const } : order) };
}

export function replaceDerivativeOrder(ledger: PaperLedger, id: string, ticket: DerivativeTicket, cutoff: number) {
  const order = ledger.orders.find(item => item.id === id);
  if (!order || !pendingOrder(order) || order.parent) throw new Error("Lệnh không còn được phép sửa.");
  return submitDerivativeOrder(cancelDerivativeOrders(ledger, [id]), ticket, cutoff);
}

function applyFill(ledger: PaperLedger, order: PaperOrder, price: number, time: number, fee: number) {
  let quantity = order.quantity ?? 1;
  const side = order.side === "BUY" ? "LONG" : "SHORT";
  const current = ledger.position;
  if (order.parent && current && current.side !== side && quantity > (current.quantity ?? 1)) {
    quantity = current.quantity ?? 1;
    order.quantity = quantity;
  }
  if (order.purpose === "CLOSE" && (!current || current.side === side || quantity > (current.quantity ?? 1))) { order.status = "cancelled"; return; }
  order.status = "filled"; order.price = price; order.filled = time;
  const detailed = order.quantity !== undefined || current?.quantity !== undefined;
  if (!current) ledger.position = { side, price, time, ...(detailed ? { quantity } : {}) };
  else if (current.side === side) {
    const total = (current.quantity ?? 1) + quantity;
    ledger.position = { ...current, price: (current.price * (current.quantity ?? 1) + price * quantity) / total, quantity: total };
  } else {
    const closed = Math.min(current.quantity ?? 1, quantity);
    ledger.pairs.push({ open: current.time, close: time, gross: (price - current.price) * (current.side === "LONG" ? 1 : -1) * closed, fee: fee * closed, ...(detailed ? { quantity: closed, openPrice: current.price, closePrice: price, side: current.side } : {}) });
    const remaining = (current.quantity ?? 1) - quantity;
    ledger.position = remaining > 0 ? { ...current, quantity: remaining } : remaining < 0 ? { side, price, time, quantity: -remaining } : null;
    if (!ledger.position || ledger.position.side !== current.side) ledger.orders.forEach(item => { if (item.parent && pendingOrder(item)) item.status = "cancelled"; });
    else if (!order.parent) {
      // Phân bổ phần đóng theo FIFO để hai nhánh OCO cùng bảo vệ khối lượng còn lại.
      let consumed = closed;
      const groups = new Set(ledger.orders.filter(item => item.parent && pendingOrder(item)).map(item => item.parent));
      for (const group of groups) {
        const children = ledger.orders.filter(item => item.parent === group && pendingOrder(item));
        const protectedQuantity = Math.max(...children.map(item => item.quantity ?? 1));
        const retained = Math.max(0, protectedQuantity - consumed);
        consumed = Math.max(0, consumed - protectedQuantity);
        children.forEach(item => { if (retained) item.quantity = retained; else item.status = "cancelled"; });
        if (!consumed) break;
      }
    }
  }
  if (order.group) ledger.orders.forEach(item => { if (item.id !== order.id && item.group === order.group && pendingOrder(item)) item.status = "cancelled"; });
  if (order.bracket && ledger.position?.side === side) {
    for (const leg of ["stop", "take"] as const) {
      const stop = leg === "stop" ? order.bracket.stopTrigger : order.bracket.takeTrigger;
      const limit = leg === "stop" ? order.bracket.stopLimit : order.bracket.takeLimit;
      ledger.orders.push({ id: `order-${ledger.orders.length + 1}`, side: order.side === "BUY" ? "SELL" : "BUY", purpose: "CLOSE", type: "STOP_LIMIT", stop, limit, submitted: time, triggered: null, status: "waiting", filled: null, price: null, quantity: Math.min(quantity, ledger.position.quantity ?? 1), strategy: "oco", parent: order.id, group: order.id, relation: (side === "LONG") === (leg === "take") ? "gte" : "lte" });
    }
  }
}

export function advanceDerivativeLedger(ledger: PaperLedger, data: ReplayData, after: number, cutoff: number, fee: number): PaperLedger {
  if (!Number.isFinite(fee) || fee < 0) throw new Error("Phí phải là số hữu hạn, không âm.");
  const result = structuredClone(ledger);
  const duration = data.granularity === "1s" ? 1 : 60;
  for (const sample of data.bars) {
    const time = sample.time + duration;
    if (time <= after || time > cutoff) continue;
    for (const order of [...result.orders]) {
      if (!pendingOrder(order) || time <= order.submitted) continue;
      if (order.expires !== undefined && time > order.expires) { order.status = "cancelled"; continue; }
      // Chỉ khớp theo mẫu đã công bố; không suy đoán đường đi giá trong nến.
      const price = sample.close;
      if (order.type === "STOP_LIMIT" && order.status === "waiting") {
        if (order.trailing) {
          const buy = order.side === "BUY";
          order.trailing.anchor = buy ? Math.min(order.trailing.anchor, price) : Math.max(order.trailing.anchor, price);
          order.stop = rounded(order.trailing.anchor + (buy ? 1 : -1) * order.trailing.amount);
          order.limit = rounded(order.stop + (buy ? 1 : -1) * order.trailing.spread);
          if (order.stop <= 0 || order.limit <= 0) { order.status = "cancelled"; continue; }
        }
        const relation = order.relation ?? (order.side === "BUY" ? "gte" : "lte");
        if (relation === "gte" ? price >= order.stop! : price <= order.stop!) { order.status = "triggered"; order.triggered = time; }
        continue;
      }
      if (order.type !== "MARKET" && !(order.side === "BUY" ? price <= order.limit! : price >= order.limit!)) continue;
      applyFill(result, order, price, time, fee);
    }
  }
  return result;
}
