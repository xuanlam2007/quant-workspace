import { useEffect, useState } from "react";
import { DRAWING_TOOL_GROUPS } from "../config/chart-config";

const FAVORITES_KEY = "chart.favoriteDrawingTools.v1";
const VISIBILITY_KEY = "ChartFavoriteDrawingToolbarWidget.visible";
const available = new Set(DRAWING_TOOL_GROUPS.flatMap((group) => group.tools.filter((tool) => tool.available !== false).map((tool) => tool.id)));

function read() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    const ids = Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === "string" && available.has(id)))] : [];
    return { ids, visible: localStorage.getItem(VISIBILITY_KEY) !== "false" };
  } catch { return { ids: [] as string[], visible: true }; }
}

export function useDrawingFavorites() {
  const [state, setState] = useState({ ids: [] as string[], visible: true });
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    setState(read()); setRestored(true);
    const sync = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY || event.key === VISIBILITY_KEY || event.key === null) setState(read());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.ids));
      localStorage.setItem(VISIBILITY_KEY, String(state.visible));
    } catch { /* Chế độ riêng tư có thể chặn lưu tùy chọn. */ }
  }, [state, restored]);
  return {
    ids: state.ids,
    visible: state.visible && state.ids.length > 0,
    toggle: (id: string) => {
      if (!available.has(id)) return;
      setState((current) => current.ids.includes(id)
        ? { ...current, ids: current.ids.filter((value) => value !== id) }
        : { ids: [...current.ids, id], visible: true });
    },
    toggleVisibility: () => setState((current) => ({ ...current, visible: !current.visible })),
    hide: () => setState((current) => ({ ...current, visible: false })),
    reorder: (ids: string[]) => setState((current) => {
      if (ids.length !== current.ids.length || new Set(ids).size !== ids.length || ids.some((id) => !current.ids.includes(id))) return current;
      return { ...current, ids };
    }),
  };
}
