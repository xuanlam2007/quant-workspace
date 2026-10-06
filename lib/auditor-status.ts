"use client";

import { engineUrl } from "./auditor-client";
import type { ConnStatus } from "./dchart-socket";

type EngineSnapshot = { status: ConnStatus | "idle"; error: string };
const initial: EngineSnapshot = { status: "idle", error: "" };
let snapshot = initial;
const listeners = new Set<() => void>();
let activated = false;
let launch: Promise<void> | undefined;
let checking = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function publish(status: EngineSnapshot["status"], error = "") {
  if (snapshot.status === status && snapshot.error === error) return;
  snapshot = { status, error };
  listeners.forEach(listener => listener());
}

export const getAuditorStatus = () => snapshot;
export const getServerAuditorStatus = () => initial;
export function subscribeAuditorStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function poll() {
  if (!activated || checking || launch || document.visibilityState !== "visible") return;
  clearTimeout(timer);
  checking = true;
  const currentGeneration = generation;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${engineUrl}/api/status`, { cache: "no-store", signal: controller.signal });
    const data = response.ok ? await response.json() : null;
    const ready = typeof data?.protocol_version === "number";
    if (currentGeneration === generation) publish(ready ? "connected" : "disconnected", ready ? "" : snapshot.error);
  } catch {
    if (currentGeneration === generation) publish("disconnected", snapshot.error);
  } finally {
    checking = false;
    clearTimeout(timeout);
    if (document.visibilityState === "visible") timer = setTimeout(poll, 5000);
  }
}

export function activateAuditor(retry = false) {
  if (launch || (activated && !retry)) return;
  if (!activated) {
    activated = true;
    // Theo dõi dịch vụ theo vòng đời trang, không theo lần đổi thẻ.
    document.addEventListener("visibilitychange", () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void poll();
    });
  }
  clearTimeout(timer);
  generation += 1;
  publish("reconnecting");
  launch = (async () => {
    try {
      const response = await fetch("/api/auditor/engine", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Engine startup failed");
      if (result.status === "ready") publish("connected");
    } catch (error) {
      publish("disconnected", error instanceof Error ? error.message : "Engine startup failed");
    }
  })().finally(() => {
    launch = undefined;
    void poll();
  });
}
