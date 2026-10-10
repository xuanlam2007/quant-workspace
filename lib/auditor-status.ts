"use client";

import { engineUrl } from "./auditor-client";
import type { ConnStatus } from "./dchart-socket";

type EngineSnapshot = { status: ConnStatus | "idle"; error: string; noticeId: number; noticeExpires: number; noticeDismissed: boolean };
const initial: EngineSnapshot = { status: "idle", error: "", noticeId: 0, noticeExpires: 0, noticeDismissed: false };
let snapshot = initial;
const listeners = new Set<() => void>();
let activated = false;
let launch: Promise<void> | undefined;
let checking = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function publish(status: EngineSnapshot["status"], error = "") {
  if (snapshot.status === status && snapshot.error === error) return;
  const newError = !!error && error !== snapshot.error;
  snapshot = { ...snapshot, status, error, ...(newError ? { noticeId: snapshot.noticeId + 1, noticeExpires: Date.now() + 10000, noticeDismissed: false } : {}) };
  listeners.forEach(listener => listener());
}

export const getAuditorStatus = () => snapshot;

export const getServerAuditorStatus = () => initial;
export function dismissAuditorError(noticeId: number) {
  if (snapshot.noticeId !== noticeId || snapshot.noticeDismissed) return;
  snapshot = { ...snapshot, noticeDismissed: true };
  listeners.forEach(listener => listener());
}
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
    const readStatus = async (path: string) => {
      const response = await fetch(`${engineUrl}${path.replace(/^\/api/, "")}`, { cache: "no-store", signal: controller.signal });
      return response.ok ? await response.json() : null;
    };
    const auditor = await readStatus("/api/status");
    if (currentGeneration === generation) {
      const ready = typeof auditor?.protocol_version === "number";
      publish(ready ? "connected" : "disconnected", ready ? "" : snapshot.error);
    }
  } catch {
    if (currentGeneration === generation) publish("disconnected", snapshot.error);
  } finally {
    checking = false;
    clearTimeout(timeout);
    if (document.visibilityState === "visible") timer = setTimeout(poll, 5000);
  }
}

export function activateAuditor(retry = false) {
  if (launch) return launch;
  if (activated && !retry) return Promise.resolve();
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
  return launch;
}
