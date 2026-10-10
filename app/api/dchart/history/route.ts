import { NextRequest, NextResponse } from "next/server";
import { marketDataConfig, marketDataHeaders } from "@/lib/server/market-data";
import { sampleHistory } from "@/lib/sample-market-data";
import { historyQuery, queryObject } from "@/lib/server/history-schema";
import { isWorkspaceRequest } from "@/lib/server/request-security";

export async function GET(request: NextRequest) {
  if (!isWorkspaceRequest(request)) return NextResponse.json({ error: "local workspace required" }, { status: 403 });
  const parsed = historyQuery.safeParse(queryObject(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid history request" }, { status: 400 });
  }
  const { symbol, resolution, from, to } = parsed.data;

  let config;
  try { config = marketDataConfig(); } catch {
    return NextResponse.json({ error: "invalid market data configuration" }, { status: 503 });
  }
  if (config.mode === "sample") {
    return NextResponse.json(sampleHistory(symbol, resolution, from, to), { headers: { "Cache-Control": "no-store" } });
  }
  const params = new URLSearchParams({
    resolution,
    symbol,
    from: String(from),
    to: String(to),
  });
  try {
    const upstream = await fetch(`${config.apiUrl}/history?${params}`, { headers: marketDataHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    if (!upstream.ok) return NextResponse.json({ error: "history service unavailable" }, { status: 502 });
    const body = JSON.stringify(await upstream.json());
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "history service unavailable" }, { status: 502 });
  }
}
