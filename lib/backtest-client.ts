export const engineUrl = "/api/backtest";

export async function backtestRequest<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(method === "POST" ? 60000 : 30000);
  const response = await fetch(`${engineUrl}${path}`, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Backtest engine chưa phản hồi.");
  return data as T;
}
