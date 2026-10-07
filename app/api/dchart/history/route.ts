import { NextRequest, NextResponse } from "next/server";
import { marketDataConfig } from "@/lib/market-data-config";
import { sampleHistory } from "@/lib/sample-market-data";
const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,32}$/;
const RESOLUTIONS = new Set(["1", "5", "15", "30", "60", "D", "W", "M"]);
const MAX_RANGE_SECONDS = 20 * 366 * 86400;

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const resolution = request.nextUrl.searchParams.get("resolution") ?? "";
  const from = Number(request.nextUrl.searchParams.get("from"));
  const to = Number(request.nextUrl.searchParams.get("to"));
  const validRange = Number.isInteger(from)
    && Number.isInteger(to)
    && from > 0
    && to > from
    && to - from <= MAX_RANGE_SECONDS;

  if (!SYMBOL_PATTERN.test(symbol) || !RESOLUTIONS.has(resolution) || !validRange) {
    return NextResponse.json({ error: "invalid history request" }, { status: 400 });
  }

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
    const upstream = await fetch(`${config.apiUrl}/history?${params}`, { cache: "no-store", signal: request.signal });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch {
    return NextResponse.json({ error: "history service unavailable" }, { status: 502 });
  }
}
