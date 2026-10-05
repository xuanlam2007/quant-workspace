import { useEffect, useRef, useState } from "react";

export function readSaved<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; }
  catch { return null; }
}

export function writeSaved(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Không làm gián đoạn biểu đồ khi bộ nhớ bị chặn hoặc đầy. */ }
}

export function overlaySaved<T>(defaults: T, saved: unknown): T {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
  const result = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    const original = result[key];
    if (value && typeof value === "object" && !Array.isArray(value)) result[key] = overlaySaved(original && typeof original === "object" ? original : {}, value);
    else if (original === undefined || original === null || typeof value === typeof original) result[key] = value;
  }
  return result as T;
}

export function mergeSaved<T>(defaults: T, saved: unknown): T {
  if (Array.isArray(defaults)) {
    if (!Array.isArray(saved)) return defaults;
    return defaults.map((item, index) => mergeSaved(item, saved[index])) as T;
  }
  if (defaults !== null && typeof defaults === "object") {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, mergeSaved(value, (saved as Record<string, unknown>)[key])])) as T;
  }
  if (defaults === null) return (saved === null || typeof saved === "number" && Number.isFinite(saved) ? saved : defaults) as T;
  return (typeof saved === typeof defaults && (typeof saved !== "number" || Number.isFinite(saved)) ? saved : defaults) as T;
}

export function useSavedState<T>(key: string, initial: T) {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const defaults = useRef(initial);
  useEffect(() => {
    setValue(mergeSaved(defaults.current, readSaved(key)));
    setLoaded(true);
  }, [key]);
  useEffect(() => { if (loaded) writeSaved(key, value); }, [key, value, loaded]);
  return [value, setValue, loaded] as const;
}
