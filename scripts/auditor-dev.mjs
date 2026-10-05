import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

async function enginePortOccupied() {
  return new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port: 8765 });
    const finish = occupied => { socket.destroy(); resolve(occupied); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}

export async function startAuditor(port) {
  if (process.env.AUDITOR_AUTOSTART === "0") return () => {};
  if (await enginePortOccupied()) {
    console.info("[auditor] Port 8765 is already in use; leaving the existing process running.");
    return () => {};
  }
  const script = fileURLToPath(new URL("../tools/quant-strategy-auditor/run.py", import.meta.url));
  const child = spawn(process.env.AUDITOR_PYTHON || "python", [script, "--watch", "--managed"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, AUDITOR_OPEN_BROWSER: "0", AUDITOR_UI_URL: `http://localhost:${port}/auditor`, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });
  child.stdin.on("error", () => {});
  child.once("error", error => console.error(`[auditor] Could not start Python: ${error.message}. Set AUDITOR_PYTHON to your Python executable.`));
  child.once("exit", code => { if (code) console.error(`[auditor] Launcher exited (${code}). Check the Python diagnostics above.`); });
  return () => { if (!child.stdin.destroyed) child.stdin.end("stop\n"); };
}
