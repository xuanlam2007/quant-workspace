const INTERVALS: Record<string, number> = {
  "1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600,
  D: 86400, W: 604800, M: 2592000,
};
export const SAMPLE_BAR_LIMIT = 20_000;

function symbolSeed(symbol: string) {
  return [...symbol].reduce((seed, char) => (seed * 31 + char.charCodeAt(0)) >>> 0, 7);
}

export function samplePrice(symbol: string, epochSeconds: number) {
  const seed = symbolSeed(symbol);
  const wave = Math.sin(epochSeconds / 93 + seed) * 5
    + Math.sin(epochSeconds / 719 + seed % 100) * 12
    + Math.sin(epochSeconds / 86400 + seed % 10) * 30;
  return Math.round((1800 + seed % 150 + wave) * 100) / 100;
}

export function sampleTick(symbol: string, time = Date.now()) {
  const seconds = Math.floor(time / 1000);
  return { symbol, time: seconds * 1000, price: samplePrice(symbol, seconds), volume: 1 + (seconds + symbolSeed(symbol)) % 10 };
}

export function sampleSymbol(symbol: string) {
  return {
    name: symbol, description: `Sample data: ${symbol}`, type: "sample", "exchange-traded": "DEMO", "exchange-listed": "DEMO",
    timezone: "Asia/Bangkok", session: "24x7", minmov: 1, pricescale: 100,
    supported_resolutions: Object.keys(INTERVALS),
  };
}

export function sampleHistory(symbol: string, resolution: string, from: number, to: number, now = Date.now()) {
  const interval = INTERVALS[resolution];
  if (!interval || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error("invalid sample range");
  const end = Math.min(Math.floor(to), Math.floor(now / 1000));
  const lastBucket = Math.floor(end / interval) * interval;
  const start = Math.max(Math.ceil(from / interval) * interval, lastBucket - (SAMPLE_BAR_LIMIT - 1) * interval);
  const result = { s: "no_data", t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[], v: [] as number[] };
  for (let time = start; time <= lastBucket; time += interval) {
    const closeTime = Math.min(time + interval - 1, end);
    const open = samplePrice(symbol, time - 1);
    const close = samplePrice(symbol, closeTime);
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    for (let step = 0; step < 12; step++) {
      const price = samplePrice(symbol, time + Math.floor((closeTime - time) * step / 12));
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
    result.t.push(time); result.o.push(open); result.h.push(high); result.l.push(low); result.c.push(close);
    result.v.push(Math.round((closeTime - time + 1) * 5.5));
  }
  if (result.t.length) result.s = "ok";
  return result;
}
