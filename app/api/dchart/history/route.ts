import { NextRequest, NextResponse } from "next/server";

const UPSTREAM_URL = "https://api.example.com/history";
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

  const params = new URLSearchParams({
    resolution,
    symbol,
    from: String(from),
    to: String(to),
  });
  try {
    const upstream = await fetch(`${UPSTREAM_URL}?${params}`, { cache: "no-store" });
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
