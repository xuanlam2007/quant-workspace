import "server-only";
import { engineEndpoint, engineHeaders, type EngineKind } from "./engine-config";
import { routeSchema, validateQuery } from "./engine-schemas";
import { isWorkspaceRequest, readJsonBody } from "./request-security";

export async function proxyEngine(request: Request, kind: EngineKind, segments: string[]) {
  if (!isWorkspaceRequest(request)) return Response.json({ detail: "Local workspace required" }, { status: 403 });
  const path = `/${segments.join("/")}`;
  const schema = routeSchema(kind, request.method, path);
  const query = new URL(request.url).searchParams;
  if (!schema || !validateQuery(path, query)) return Response.json({ detail: "Unsupported engine request" }, { status: 400 });
  let body: string | undefined;
  try {
    const value = await readJsonBody(request);
    const parsed = schema.safeParse(value);
    if (!parsed.success) return Response.json({ detail: "Invalid request", errors: parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code })) }, { status: 422 });
    if (request.method === "POST") body = JSON.stringify(parsed.data);
  } catch { return Response.json({ detail: "Invalid JSON body or request too large" }, { status: 400 }); }
  try {
    const upstream = await fetch(`${engineEndpoint(kind)}/api${path}${query.size ? `?${query}` : ""}`, {
      method: request.method, headers: { ...engineHeaders(), ...(body ? { "Content-Type": "application/json" } : {}), ...(request.headers.has("range") ? { Range: request.headers.get("range")! } : {}) }, body,
      cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(path.endsWith("/analyze") ? 180000 : 45000)]),
    });
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-length", "content-disposition", "accept-ranges", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (path.endsWith("/report/html")) headers.set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return Response.json({ detail: "Engine unavailable. Reconnect and check Terminal." }, { status: 502 }); }
}
