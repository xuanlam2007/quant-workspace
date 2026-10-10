export type ReplayBar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ReplayData = { symbol: string; granularity: "1s" | "1m"; demo: boolean; bars: ReplayBar[] };
export type ReplayFrame = { cutoff: number; bars: ReplayBar[]; samples: ReplayBar[]; minute: number };
export type ReplayDrawing = { id: string; tool: "TrendLine" | "HorizontalLine" | "Ray" | "ExtendedLine"; points: { timestamp: number; price: number }[]; label: string };
export type ReplayChartPort = { screenshot: () => string; drawings: () => ReplayDrawing[]; apply: (drawings: ReplayDrawing[]) => void; reset: () => void };
export type ChartReplay = { frame: ReplayFrame | null; symbol: string; session: number; busy: boolean; onReady: (port: ReplayChartPort | null) => void };
export type BacktestDecision = {
  action: "HOLD" | "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "CANCEL";
  order_type: "MARKET" | "LIMIT" | "STOP_LIMIT";
  stop_price: number | null; limit_price: number | null;
  reason: string; question: string; drawings: ReplayDrawing[];
};
export type PaperOrder = {
  id: string; side: "BUY" | "SELL"; purpose: "OPEN" | "CLOSE";
  type: BacktestDecision["order_type"]; stop: number | null; limit: number | null;
  submitted: number; triggered: number | null; status: "waiting" | "triggered" | "filled" | "cancelled";
  filled: number | null; price: number | null;
};
export type PaperLedger = {
  orders: PaperOrder[];
  position: { side: "LONG" | "SHORT"; price: number; time: number } | null;
  pairs: { open: number; close: number; gross: number; fee: number }[];
};
export const emptyLedger = (): PaperLedger => ({ orders: [], position: null, pairs: [] });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseReplayData(input: unknown): ReplayData {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("File phải chứa symbol, granularity và bars.");
  const data = input as Record<string, unknown>;
  if (typeof data.symbol !== "string" || !/^[\w.-]{1,40}$/.test(data.symbol)) throw new Error("Mã giao dịch không hợp lệ.");
  if (data.granularity !== "1s" && data.granularity !== "1m") throw new Error("granularity phải là 1s hoặc 1m.");
  if (!Array.isArray(data.bars) || !data.bars.length || data.bars.length > 120000) throw new Error("Cần từ 1 đến 120.000 mẫu giá.");
  let previous = -1;
  const bars = data.bars.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Mẫu giá không hợp lệ.");
    const row = item as Record<string, unknown>;
    const values = [row.time, row.open, row.high, row.low, row.close, row.volume];
    if (!values.every(finite)) throw new Error("Giá và thời gian phải là số hữu hạn.");
    const bar = { time: row.time as number, open: row.open as number, high: row.high as number, low: row.low as number, close: row.close as number, volume: row.volume as number };
    if (!Number.isInteger(bar.time) || bar.time <= previous || bar.time < 0 || bar.time > 4102444800) throw new Error("Thời gian phải là Unix giây, tăng dần và không trùng.");
    if (Math.min(bar.open, bar.close, bar.low) <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0) throw new Error("OHLC hoặc volume không hợp lệ.");
    if (data.granularity === "1m" && bar.time % 60) throw new Error("Nến M1 phải bắt đầu tại giây 00.");
    previous = bar.time;
    return bar;
  });
  if (new Set(bars.map(bar => Math.floor((bar.time + 7 * 3600) / 86400))).size !== 1) throw new Error("Mỗi lượt replay chỉ nhận một ngày giao dịch (UTC+7).");
  return { symbol: data.symbol, granularity: data.granularity, demo: data.demo === true, bars };
}

export function replayMinutes(data: ReplayData): number[] {
  return [...new Set(data.bars.map(bar => Math.floor(bar.time / 60) * 60))];
}

export function replayLogicalRange(barCount: number, plotWidth: number): { from: number; to: number } | null {
  if (barCount <= 0 || plotWidth <= 0) return null;
  // Giữ overview với bar spacing 9 px, thu nhỏ khi nến đã mở vượt viewport.
  const to = barCount - 1 + 6;
  return { from: Math.min(-0.5, to + 1 - plotWidth / 9), to };
}

export function replayFrame(data: ReplayData, index: number, evaluationSecond = 55): ReplayFrame {
  const minutes = replayMinutes(data);
  if (index < 0) return { cutoff: minutes[0], minute: minutes[0], samples: [], bars: [] };
  const minute = minutes[Math.max(0, Math.min(minutes.length - 1, index))];
  const cutoff = minute + (data.granularity === "1m" ? 60 : Math.max(55, Math.min(60, Math.floor(evaluationSecond))));
  const duration = data.granularity === "1s" ? 1 : 60;
  const samples = data.bars.filter(bar => bar.time + duration <= cutoff);
  const grouped = new Map<number, ReplayBar>();
  for (const sample of samples) {
    const time = Math.floor(sample.time / 60) * 60;
    const bar = grouped.get(time);
    if (bar) { bar.high = Math.max(bar.high, sample.high); bar.low = Math.min(bar.low, sample.low); bar.close = sample.close; bar.volume += sample.volume; }
    else grouped.set(time, { ...sample, time });
  }
  return { cutoff, minute, samples, bars: [...grouped.values()] };
}

export function exampleReplay(): ReplayData {
  const start = Math.floor(Date.UTC(2026, 0, 5, 2) / 1000);
  let close = 100;
  const bars = Array.from({ length: 90 }, (_, index) => {
    const open = close;
    close = Math.round((open + Math.sin(index / 5) * .7 + Math.cos(index / 11) * .2) * 100) / 100;
    return { time: start + index * 60, open, high: Math.max(open, close) + .3, low: Math.min(open, close) - .3, close, volume: 100 + index % 20 * 8 };
  });
  return { symbol: "DEMO", granularity: "1m", demo: true, bars };
}

export function submitPaperOrder(ledger: PaperLedger, decision: BacktestDecision, cutoff: number): PaperLedger {
  if (decision.action === "HOLD") return ledger;
  if (decision.action === "CANCEL") return { ...ledger, orders: ledger.orders.map(order => ["waiting", "triggered"].includes(order.status) ? { ...order, status: "cancelled" } : order) };
  if (ledger.orders.some(order => order.status === "waiting" || order.status === "triggered")) throw new Error("Hủy hoặc xử lý lệnh chờ trước khi tạo lệnh khác.");
  const closing = decision.action === "CLOSE";
  if (closing && !ledger.position) throw new Error("Không có vị thế để đóng.");
  if (!closing && ledger.position) throw new Error("Bản mô phỏng này hỗ trợ một vị thế, một hợp đồng; chưa hỗ trợ scale in.");
  if (decision.order_type !== "MARKET" && (!finite(decision.limit_price) || decision.limit_price <= 0)) throw new Error("Lệnh Limit cần giá giới hạn hợp lệ.");
  if (decision.order_type === "STOP_LIMIT" && (!finite(decision.stop_price) || decision.stop_price <= 0)) throw new Error("Stop-Limit cần giá kích hoạt hợp lệ.");
  const side = closing ? ledger.position!.side === "LONG" ? "SELL" : "BUY" : decision.action === "OPEN_LONG" ? "BUY" : "SELL";
  const order: PaperOrder = { id: `order-${ledger.orders.length + 1}`, side, purpose: closing ? "CLOSE" : "OPEN", type: decision.order_type, stop: decision.stop_price, limit: decision.limit_price, submitted: cutoff, triggered: null, status: "waiting", filled: null, price: null };
  return { ...ledger, orders: [...ledger.orders, order] };
}

export function advancePaperLedger(ledger: PaperLedger, data: ReplayData, after: number, cutoff: number, fee: number): PaperLedger {
  if (!finite(fee) || fee < 0) throw new Error("Phí phải là số hữu hạn, không âm.");
  let result: PaperLedger = { orders: ledger.orders.map(order => ({ ...order })), position: ledger.position ? { ...ledger.position } : null, pairs: [...ledger.pairs] };
  const duration = data.granularity === "1s" ? 1 : 60;
  for (const sample of data.bars) {
    const available = sample.time + duration;
    if (available <= after || available > cutoff) continue;
    const order = result.orders.find(item => item.status === "waiting" || item.status === "triggered");
    if (!order || available <= order.submitted) continue;
    // Chỉ dùng giá đóng của mẫu đã mở, không đoán thứ tự chạm giá bên trong OHLC.
    const price = sample.close;
    if (order.type === "STOP_LIMIT" && order.status === "waiting") {
      if (order.side === "BUY" ? price >= order.stop! : price <= order.stop!) { order.status = "triggered"; order.triggered = available; }
      continue;
    }
    if (order.type !== "MARKET" && !(order.side === "BUY" ? price <= order.limit! : price >= order.limit!)) continue;
    order.status = "filled"; order.filled = available; order.price = price;
    if (order.purpose === "OPEN") result = { ...result, position: { side: order.side === "BUY" ? "LONG" : "SHORT", price, time: available } };
    else if (result.position) {
      result.pairs.push({ open: result.position.time, close: available, gross: (price - result.position.price) * (result.position.side === "LONG" ? 1 : -1), fee });
      result.position = null;
    }
  }
  return result;
}
