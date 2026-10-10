import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { engineEndpoint, engineHeaders, engineToken, type EngineKind } from "./engine-config";
import { emptyBodySchema } from "./engine-schemas";
import { isWorkspaceRequest, readJsonBody } from "./request-security";

type LaunchState = { launch?: Promise<void>; child?: ChildProcess };
const globalState = globalThis as typeof globalThis & { quantEngines?: Partial<Record<EngineKind, LaunchState>> };

function enginePython(executable: string) {
  if (process.platform !== "win32") return executable;
  const name = basename(executable);
  if (!/^(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?$/i.test(name)) return executable;
  const folders = /[\\/]/.test(executable) ? [dirname(resolve(executable))] : (process.env.PATH || "").split(delimiter).filter(Boolean).map(folder => folder.replace(/^"|"$/g, ""));
  const consoleName = name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`;
  const folder = folders.find(candidate => existsSync(join(candidate, consoleName)));
  if (!folder) return executable;
  // Giữ đúng interpreter hoặc virtualenv, chỉ đổi sang biến thể không có console.
  const windowless = join(folder, /^py(?:\.exe)?$/i.test(name) ? "pyw.exe" : "pythonw.exe");
  return existsSync(windowless) ? windowless : executable;
}

export function engineStartHandler(kind: EngineKind) {
  const prefix = kind.toUpperCase();
  const port = kind === "auditor" ? 8765 : 8766;
  const state = (globalState.quantEngines ??= {})[kind] ??= {};
  const ready = async () => {
    try {
      const response = await fetch(`${engineEndpoint(kind)}/api/${kind === "auditor" ? "status" : "health"}`, { headers: engineHeaders(), cache: "no-store", signal: AbortSignal.timeout(1000) });
      const data = response.ok ? await response.json() : null;
      return typeof data?.protocol_version === "number" && (kind === "auditor" || data.engine === "backtest");
    } catch { return false; }
  };
  const launch = async () => {
    const child = spawn(enginePython(process.env[`${prefix}_PYTHON`] || "python"), [resolve(process.cwd(), "tools/quant-strategy-auditor/run.py"), "--watch", "--managed", "--engine", kind], {
      cwd: process.cwd(), env: { ...process.env, QUANT_ENGINE_TOKEN: engineToken(), AUDITOR_OPEN_BROWSER: "0", PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout?.pipe(process.stdout, { end: false });
    child.stderr?.pipe(process.stderr, { end: false });
    state.child = child;
    child.stdin?.on("error", () => {});
    child.once("exit", () => { if (state.child === child) state.child = undefined; });
    await new Promise<void>((resolveSpawn, reject) => { child.once("spawn", resolveSpawn); child.once("error", reject); });
  };
  const ensure = async () => {
    if (await ready()) return;
    if (!state.child || state.child.exitCode !== null) await launch();
    else state.child.stdin?.write("retry\n");
    const deadline = Date.now() + 30000;
    let relaunched = false;
    while (Date.now() < deadline) {
      if (await ready()) return;
      if ((!state.child || state.child.exitCode !== null) && !relaunched) { relaunched = true; await launch(); }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
    throw new Error("Engine startup failed");
  };
  return async (request: Request) => {
    if (!isWorkspaceRequest(request)) return Response.json({ error: "Engine startup requires the local workspace." }, { status: 403 });
    try {
      if (!emptyBodySchema.safeParse(await readJsonBody(request, 1024)).success) return Response.json({ error: "This route accepts only an empty object." }, { status: 422 });
    } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }
    try {
      if (process.env[`${prefix}_AUTOSTART`] === "0") return Response.json({ status: "manual" });
      if (![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(engineEndpoint(kind))) return Response.json({ status: "manual" });
      state.launch ??= ensure().finally(() => { state.launch = undefined; });
      await state.launch;
      return Response.json({ status: "ready" });
    } catch { return Response.json({ error: `The ${kind} engine did not become ready. Check Terminal for Python errors.` }, { status: 503 }); }
  };
}
