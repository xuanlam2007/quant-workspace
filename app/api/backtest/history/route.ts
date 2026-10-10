import { NextRequest, NextResponse } from "next/server";
import { marketDataConfig, marketDataHeaders } from "@/lib/server/market-data";
import { sampleHistory } from "@/lib/sample-market-data";
import { parseReplayData } from "@/lib/backtest";
import { queryObject, replayQuery } from "@/lib/server/history-schema";
import { isWorkspaceRequest } from "@/lib/server/request-security";

type History = { s: string; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };

export async function GET(request: NextRequest) {
  if (!isWorkspaceRequest(request)) return NextResponse.json({ error: "local workspace required" }, { status: 403 });
  const parsed = replayQuery.safeParse(queryObject(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Chọn một mã và một ngày lịch sử hợp lệ." }, { status: 400 });
  }
  const { symbol, granularity, from, to } = parsed.data;
  if (granularity === "1s") return NextResponse.json({ error: "Kết nối lịch sử chart hiện hỗ trợ M1, không hỗ trợ 1S. Timestamp Unix theo giây không phải lịch sử mỗi giây. Nhập JSON có mẫu giây thực để replay dữ liệu giây." }, { status: 422 });
  try {
    const config = marketDataConfig();
    const resolution = "1";
    let source: History;
    if (config.mode === "sample") {
      source = sampleHistory(symbol, resolution, from, to) as History;
    } else {
      const query = new URLSearchParams({ symbol, resolution, from: String(from), to: String(to) });
      const upstream = await fetch(`${config.apiUrl}/history?${query}`, { headers: marketDataHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
      if (!upstream.ok) return NextResponse.json({ error: "Nguồn lịch sử chưa đáp ứng yêu cầu. Không thay bằng dữ liệu minh họa." }, { status: 502 });
      source = await upstream.json();
    }
    if (source.s === "no_data") return NextResponse.json({ error: "Không có dữ liệu trong ngày đã chọn." }, { status: 404 });
    const arrays = [source.t, source.o, source.h, source.l, source.c, source.v];
    if (source.s !== "ok" || !arrays.every(Array.isArray) || !arrays.every(values => values.length === source.t.length)) throw new Error("Malformed history");
    const completedThrough = Math.floor(Date.now() / 1000);
    const bars = source.t.map((time, index) => ({ time, open: source.o[index], high: source.h[index], low: source.l[index], close: source.c[index], volume: source.v[index] })).filter(bar => bar.time >= from && bar.time <= to && bar.time + 60 <= completedThrough);
    return NextResponse.json(parseReplayData({ symbol, granularity, demo: config.mode === "sample", bars }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Lịch sử hoặc cấu hình nguồn dữ liệu không hợp lệ. Không dựng tick hay thay bằng dữ liệu minh họa." }, { status: 502 });
  }
}
