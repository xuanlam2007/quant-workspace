import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export const runtime = "nodejs";
const state = globalThis as typeof globalThis & {
  auditorLaunch?: Promise<void>;
  auditorChild?: ChildProcess;
};

async function isReady() {
  try {
    const response = await fetch("http://127.0.0.1:8765/api/status", { cache: "no-store", signal: AbortSignal.timeout(1000) });
    const data = response.ok ? await response.json() : null;
    return typeof data?.protocol_version === "number";
  } catch { return false; }
}

async function ensureEngine() {
  if (await isReady()) return;
  if (!state.auditorChild || state.auditorChild.exitCode !== null) {
    const child = spawn(process.env.AUDITOR_PYTHON || "python", [resolve(process.cwd(), "tools/quant-strategy-auditor/run.py"), "--watch", "--managed"], {
      cwd: process.cwd(),
      env: { ...process.env, AUDITOR_OPEN_BROWSER: "0", PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "inherit", "inherit"],
      windowsHide: true,
    });
    state.auditorChild = child;
    child.stdin?.on("error", () => {});
    child.once("exit", () => { if (state.auditorChild === child) state.auditorChild = undefined; });
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", error => {
        if (state.auditorChild === child) state.auditorChild = undefined;
        reject(new Error(`Could not start Python: ${error.message}. Check AUDITOR_PYTHON.`));
      });
    });
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isReady()) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  throw new Error("The auditor engine did not become ready. Check the development terminal for Python errors.");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || new URL(origin).host !== host || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
    return Response.json({ error: "Engine startup requires the local workspace." }, { status: 403 });
  }
  if (process.env.AUDITOR_AUTOSTART === "0") return Response.json({ status: "manual" });
  if (process.env.NEXT_PUBLIC_AUDITOR_ENGINE_URL && !["http://127.0.0.1:8765", "http://localhost:8765"].includes(process.env.NEXT_PUBLIC_AUDITOR_ENGINE_URL.replace(/\/$/, ""))) {
    return Response.json({ status: "external" });
  }
  try {
    state.auditorLaunch ??= ensureEngine().finally(() => { state.auditorLaunch = undefined; });
    await state.auditorLaunch;
    return Response.json({ status: "ready" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Engine startup failed" }, { status: 503 });
  }
}
