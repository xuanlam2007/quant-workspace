import { NextRequest, NextResponse } from "next/server";
import { marketDataConfig } from "@/lib/market-data-config";
import { sampleSymbol } from "@/lib/sample-market-data";
const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,32}$/;

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }

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
      signal: request.signal,
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch {
    return NextResponse.json({ error: "symbol service unavailable" }, { status: 502 });
  }
}
