import { NextResponse } from "next/server";
import { marketDataConfig } from "@/lib/market-data-config";

export async function GET() {
  try {
    const config = marketDataConfig();
    return NextResponse.json(config.mode === "sample" ? config : {
      mode: config.mode, name: config.name, socketUrl: config.socketUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "invalid market data configuration" }, { status: 503 });
  }
}
