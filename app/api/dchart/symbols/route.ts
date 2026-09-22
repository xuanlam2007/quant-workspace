import { NextRequest, NextResponse } from "next/server";

const UPSTREAM_URL = "https://api.example.com/symbols";
const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,32}$/;

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${UPSTREAM_URL}?${new URLSearchParams({ symbol })}`, {
      cache: "no-store",
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
