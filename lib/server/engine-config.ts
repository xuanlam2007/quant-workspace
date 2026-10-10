import "server-only";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type EngineKind = "auditor" | "backtest";

export function engineEndpoint(kind: EngineKind) {
  const prefix = kind.toUpperCase();
  const value = process.env[`${prefix}_ENGINE_URL`] || process.env[`NEXT_PUBLIC_${prefix}_ENGINE_URL`] || `http://127.0.0.1:${kind === "auditor" ? 8765 : 8766}`;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Invalid engine configuration");
  }
  // Local-only: không biến route này thành proxy cho một server tùy ý.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Engine must run on loopback");
  return url.origin;
}

export function engineToken() {
  if (process.env.QUANT_ENGINE_TOKEN) {
    const token = process.env.QUANT_ENGINE_TOKEN;
    if (!/^[\x21-\x7e]{32,256}$/.test(token)) throw new Error("Invalid engine authentication configuration");
    return token;
  }
  const folder = resolve(process.cwd(), ".agents");
  const path = resolve(folder, "engine-token");
  mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid engine authentication configuration");
  return token;
}

export function engineHeaders() {
  return { "x-quant-engine-token": engineToken() };
}
