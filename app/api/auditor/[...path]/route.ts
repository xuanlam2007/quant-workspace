import { proxyEngine } from "@/lib/server/engine-proxy";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyEngine(request, "auditor", (await context.params).path);
}
export { handle as GET, handle as POST, handle as DELETE };
