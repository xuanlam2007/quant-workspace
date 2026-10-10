import "server-only";
import { marketDataConfig as parseMarketDataConfig } from "../market-data-config";

export function marketDataConfig() {
  return parseMarketDataConfig(process.env);
}

export function marketDataHeaders(): Record<string, string> {
  const token = process.env.MARKET_DATA_API_TOKEN;
  if (!token) return {};
  if (/[\x00-\x20\x7f]/.test(token)) throw new Error("Invalid market data authentication configuration");
  return { Authorization: `Bearer ${token}` };
}
