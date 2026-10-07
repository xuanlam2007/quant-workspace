"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import type { Bar } from "@/lib/dchart-api";

export function createQuoteStore() {
  let bar: Bar | undefined;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => bar,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (next: Bar | undefined | ((current: Bar | undefined) => Bar | undefined)) => {
      const value = typeof next === "function" ? next(bar) : next;
      if (value === bar) return;
      bar = value;
      listeners.forEach((listener) => listener());
    },
  };
}

export function LiveMarketData({ store, children }: {
  store: ReturnType<typeof createQuoteStore>;
  children: (bar: Bar | undefined) => ReactNode;
}) {
  const bar = useSyncExternalStore(store.subscribe, store.getSnapshot, () => undefined);
  return children(bar);
}
