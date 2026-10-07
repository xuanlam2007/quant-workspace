export const DRAWING_HISTORY_VERSION = 2;
export const MAX_DRAWING_HISTORY_STATES = 100;

export type StoredDrawingHistory = {
  version: typeof DRAWING_HISTORY_VERSION;
  day: string;
  undo: string[];
  redo: string[];
};

export function drawingHistoryDay(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)?.value).join("-");
}

export function restoreDrawingHistory(stored: string | null, current: string, day: string, normalize: (value: string) => string): StoredDrawingHistory {
  const fallback: StoredDrawingHistory = { version: DRAWING_HISTORY_VERSION, day, undo: [current], redo: [] };
  if (!stored) return fallback;
  try {
    const history = JSON.parse(stored) as Partial<StoredDrawingHistory>;
    if (history.version !== DRAWING_HISTORY_VERSION || history.day !== day) return fallback;
    const states = (value: unknown) => Array.isArray(value) ? value.filter((state): state is string => {
      if (typeof state !== "string") return false;
      try { return Array.isArray(JSON.parse(state)); } catch { return false; }
    }).map(normalize).slice(-MAX_DRAWING_HISTORY_STATES) : [];
    const undo = states(history.undo);
    return undo.length > 0 && undo.at(-1) === current ? { ...fallback, undo, redo: states(history.redo) } : fallback;
  } catch { return fallback; }
}
