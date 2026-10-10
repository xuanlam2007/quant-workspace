import { NextResponse } from "next/server";
import { marketDataConfig } from "@/lib/server/market-data";
import { isWorkspaceRequest } from "@/lib/server/request-security";

export async function GET(request: Request) {
  if (!isWorkspaceRequest(request)) return NextResponse.json({ error: "local workspace required" }, { status: 403 });
  if (new URL(request.url).searchParams.size) return NextResponse.json({ error: "unexpected query fields" }, { status: 400 });
  try {
    const config = marketDataConfig();
    return NextResponse.json(config.mode === "sample" ? config : {
      mode: config.mode, name: config.name, socketUrl: config.socketUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "invalid market data configuration" }, { status: 503 });
  }
}
