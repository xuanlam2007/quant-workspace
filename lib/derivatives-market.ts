import { z } from "zod";

const price = z.number().finite().positive();
const volume = z.number().finite().nonnegative();
const time = z.number().int().nonnegative();
const level = z.strictObject({ price, quantity: volume });
const quote = z.strictObject({
  time, bids: z.array(level).max(10), asks: z.array(level).max(10),
  reference: price.optional(), ceiling: price.optional(), floor: price.optional(),
  foreignBuy: volume.optional(), foreignSell: volume.optional(), underlying: price.optional(),
});
const trade = z.strictObject({ time, price, quantity: volume, side: z.enum(["BUY", "SELL", "UNKNOWN"]).optional() });
const schema = z.strictObject({ quotes: z.array(quote).max(120000).default([]), trades: z.array(trade).max(120000).default([]) });
export type ReplayMarket = z.infer<typeof schema>;
export type ReplayQuote = ReplayMarket["quotes"][number];

export function parseReplayMarket(input: unknown): ReplayMarket {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("Dữ liệu market không hợp lệ: cần quotes và trades có thời gian, giá, khối lượng hợp lệ.");
  for (const rows of [parsed.data.quotes, parsed.data.trades]) {
    if (rows.some((row, index) => index > 0 && row.time < rows[index - 1].time)) throw new Error("Dữ liệu thị trường phải tăng dần theo thời gian.");
  }
  return parsed.data;
}

export function replayMarketAt(market: ReplayMarket | undefined, cutoff: number) {
  return { quote: market?.quotes.findLast(item => item.time <= cutoff) ?? null, trades: market?.trades.filter(item => item.time <= cutoff) ?? [] };
}

export function volumeByPrice(trades: ReplayMarket["trades"]) {
  const totals = new Map<number, number>();
  trades.forEach(trade => totals.set(trade.price, (totals.get(trade.price) ?? 0) + trade.quantity));
  return [...totals].sort(([a], [b]) => a - b).map(([price, quantity]) => ({ price, quantity }));
}
