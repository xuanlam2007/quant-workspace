import "server-only";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isWorkspaceRequest(request: Request) {
  try {
    const url = new URL(request.url);
    if (!LOCAL_HOSTS.has(url.hostname)) return false;
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== url.origin) return false;
    const site = request.headers.get("sec-fetch-site");
    if (site && !["same-origin", "none"].includes(site)) return false;
    return request.method === "GET" || request.method === "HEAD" || origin !== null;
  } catch { return false; }
}

export async function readJsonBody(request: Request, limit = 32 * 1024 * 1024): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Request too large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return {};
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("JSON content type required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
