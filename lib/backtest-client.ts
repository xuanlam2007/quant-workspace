export const engineUrl = "/api/backtest";

export async function backtestRequest<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(`${engineUrl}${path}`, { method, cache: "no-store", signal: AbortSignal.timeout(method === "POST" ? 60000 : 5000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Backtest engine chưa phản hồi.");
  return data as T;
}
