import chartTools from "./backtest-chart-tools.json" with { type: "json" };

export type ReplayBar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type ReplayData = { symbol: string; granularity: "1s" | "1m"; demo: boolean; bars: ReplayBar[] };
export type ReplayFrame = { cutoff: number; bars: ReplayBar[]; samples: ReplayBar[]; minute: number };
export const replayDrawingPoints = chartTools.drawings;
export const replayIndicatorCatalog = chartTools.indicators;
export type ReplayIndicator = { id: string; name: string; inputs: { id: string; value: string | number | boolean }[]; visible: boolean; operation: "upsert" | "remove" };
export type ReplayIndicatorState = ReplayIndicator & { status?: "ready" | "loading" | "error"; error?: string };
export type ReplayDrawing = { id: string; tool: keyof typeof replayDrawingPoints; points: { timestamp: number; price: number }[]; label: string };
export type ReplayChartPort = { capture: () => { frame: ReplayFrame; image: string; drawings: ReplayDrawing[]; indicators: ReplayIndicatorState[] }; screenshot: () => string; drawings: () => ReplayDrawing[]; apply: (drawings: ReplayDrawing[], indicators?: ReplayIndicator[]) => Promise<void>; reset: () => void };
export type ChartReplay = { frame: ReplayFrame | null; symbol: string; session: number; busy: boolean; orders?: PaperOrder[]; granularity?: ReplayData["granularity"]; onReady: (port: ReplayChartPort | null) => void };
export type BacktestDecision = {
  action: "HOLD" | "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "CANCEL";
  order_type: "MARKET" | "LIMIT" | "STOP_LIMIT";
  stop_price: number | null; limit_price: number | null;
  reason: string; question: string; drawings: ReplayDrawing[]; indicators?: ReplayIndicator[];
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
export const paperLedgerContext = (ledger: PaperLedger): string => JSON.stringify(ledger);

export function submitTimedPaperOrder(ledger: PaperLedger, decision: BacktestDecision, context: string, observed: number, received: number): PaperLedger {
  if (decision.question || decision.action === "HOLD") return ledger;
  // Chặn quyết định cũ ghi đè execution mới; lệnh chỉ có hiệu lực tại thời điểm nhận.
  if (received < observed || context !== paperLedgerContext(ledger)) throw new Error("Ledger đã thay đổi trong lúc AI xử lý. Bỏ lệnh cũ, phân tích lại chart hiện tại.");
  return submitPaperOrder(ledger, decision, received);
}

export function paperOrderMarkers(orders: PaperOrder[], frame: ReplayFrame, granularity: ReplayData["granularity"] = "1m") {
  const duration = granularity === "1s" ? 1 : 60;
  const markers: { id: string; time: number; position: "belowBar" | "aboveBar"; shape: "square" | "arrowUp" | "arrowDown"; color: string; text: string }[] = [];
  for (const order of orders) {
    const submitted = frame.samples.findLast(sample => sample.time + duration <= order.submitted);
    if (!submitted || order.submitted > frame.cutoff) continue;
    const position = order.side === "BUY" ? "belowBar" : "aboveBar";
    const color = order.side === "BUY" ? "#089981" : "#f23645";
    markers.push({ id: `${order.id}-submitted`, time: Math.floor(submitted.time / 60) * 60, position, shape: "square", color: order.status === "cancelled" ? "#787b86" : color, text: `${order.id} ${order.side} ${order.purpose === "CLOSE" ? "đóng " : ""}${order.type} ${order.limit ?? order.stop ?? submitted.close}${order.status === "cancelled" ? " · hủy" : " · gửi"}` });
    if (order.filled !== null && order.filled <= frame.cutoff) {
      const filled = frame.samples.findLast(sample => sample.time + duration <= order.filled!);
      if (filled) markers.push({ id: `${order.id}-filled`, time: Math.floor(filled.time / 60) * 60, position, shape: order.side === "BUY" ? "arrowUp" : "arrowDown", color, text: `${order.id} ${order.side} 1 @ ${order.price} · khớp` });
    }
  }
  return markers.sort((a, b) => a.time - b.time);
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateReplayIndicator(indicator: ReplayIndicator): void {
  const definition = replayIndicatorCatalog.find(entry => entry.name === indicator.name);
  if (!definition) throw new Error(`Chỉ báo không được hỗ trợ: ${indicator.name}`);
  const seen = new Set<string>();
  for (const input of indicator.inputs) {
    const spec = definition.inputs.find(entry => entry.id === input.id) as { type: string; min?: number; max?: number; options?: (string | number | boolean)[] } | undefined;
    if (!spec || seen.has(input.id)) throw new Error(`Input chỉ báo không hợp lệ: ${input.id}`);
    seen.add(input.id);
    const value = input.value;
    const numeric = spec.type === "integer" || spec.type === "float" || spec.type === "time";
    if (numeric && (!finite(value) || spec.type !== "float" && !Number.isInteger(value) || spec.min !== undefined && value < spec.min || spec.max !== undefined && value > spec.max)
      || spec.type === "bool" && typeof value !== "boolean"
      || !numeric && spec.type !== "bool" && (typeof value !== "string" || value.length > 160)
      || spec.options && !spec.options.includes(value)) throw new Error(`Giá trị input chỉ báo không hợp lệ: ${input.id}`);
  }
}

export function paperOrderLevels(orders: PaperOrder[], frame: ReplayFrame, granularity: ReplayData["granularity"] = "1m") {
  const levels: { price: number; color: string; title: string }[] = [];
  const duration = granularity === "1s" ? 1 : 60;
  for (const order of orders) {
    if (order.submitted > frame.cutoff || !["waiting", "triggered"].includes(order.status)) continue;
    const observed = frame.samples.findLast(sample => sample.time + duration <= order.submitted);
    const color = order.side === "BUY" ? "#089981" : "#f23645";
    const prices = order.type === "MARKET" ? [["MARKET chờ khớp", observed?.close]] as const : [["Stop", order.stop], ["Limit", order.limit]] as const;
    for (const [label, price] of prices) if (price !== null && price !== undefined) levels.push({ price, color, title: `${order.id} ${order.side} ${label}` });
  }
  return levels;
}

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
