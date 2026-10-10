import { z } from "zod";
import { engineEndpoint, engineHeaders } from "@/lib/server/engine-config";
import { isWorkspaceRequest, readJsonBody } from "@/lib/server/request-security";
export const runtime = "nodejs";
const schema = z.strictObject({ client_id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/) });

export async function POST(request: Request) {
  if (!isWorkspaceRequest(request)) return Response.json({ error: "Local workspace required" }, { status: 403 });
  try {
    const parsed = schema.safeParse(await readJsonBody(request, 1024));
    if (!parsed.success) return Response.json({ error: "Invalid client identifier" }, { status: 422 });
    const address = new URL(engineEndpoint("auditor"));
    const upstream = await fetch(`${address.origin}/api/socket-ticket`, { method: "POST", headers: { ...engineHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) return Response.json({ error: "Engine connection unavailable" }, { status: upstream.status });
    const result = await upstream.json();
    if (!/^[a-f0-9]{32}$/.test(result.ticket)) throw new Error("Invalid ticket");
    address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
    address.pathname = "/ws";
    address.searchParams.set("client_id", parsed.data.client_id);
    address.searchParams.set("ticket", result.ticket);
    return Response.json({ url: address.toString() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Engine connection unavailable" }, { status: 503 }); }
}
