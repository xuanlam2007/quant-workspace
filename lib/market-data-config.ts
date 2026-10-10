export type MarketDataConfig =
  | { mode: "sample"; name: "Sample data" }
  | { mode: "live"; name: string; apiUrl: string; socketUrl: string };

function endpoint(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) return undefined;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("invalid provider endpoint");
  }
  return url.toString().replace(/\/$/, "");
}

export function marketDataConfig(env: Record<string, string | undefined>): MarketDataConfig {
  const apiUrl = endpoint(env.MARKET_DATA_API_URL);
  const socketUrl = endpoint(env.MARKET_DATA_SOCKET_URL);
  if (!apiUrl && !socketUrl) return { mode: "sample", name: "Sample data" };
  if (!apiUrl || !socketUrl) throw new Error("configure both market data endpoints");
  return { mode: "live", name: env.MARKET_DATA_PROVIDER_NAME?.trim() || "Market data", apiUrl, socketUrl };
}
