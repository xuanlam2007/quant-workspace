import { NextRequest, NextResponse } from "next/server";
import { marketDataConfig, marketDataHeaders } from "@/lib/server/market-data";
import { sampleSymbol } from "@/lib/sample-market-data";
import { symbolQuery, queryObject } from "@/lib/server/history-schema";
import { isWorkspaceRequest } from "@/lib/server/request-security";

export async function GET(request: NextRequest) {
  if (!isWorkspaceRequest(request)) return NextResponse.json({ error: "local workspace required" }, { status: 403 });
  const parsed = symbolQuery.safeParse(queryObject(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  const { symbol } = parsed.data;

  let config;
  try { config = marketDataConfig(); } catch {
    return NextResponse.json({ error: "invalid market data configuration" }, { status: 503 });
  }
  if (config.mode === "sample") {
    return NextResponse.json(sampleSymbol(symbol), { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const upstream = await fetch(`${config.apiUrl}/symbols?${new URLSearchParams({ symbol })}`, {
      cache: "no-store",
      headers: marketDataHeaders(), redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (!upstream.ok) return NextResponse.json({ error: "symbol service unavailable" }, { status: 502 });
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
    return NextResponse.json({ error: "symbol service unavailable" }, { status: 502 });
  }
}
