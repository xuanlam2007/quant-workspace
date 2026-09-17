import { useEffect, useState } from "react";
import { INDICATOR_SETTINGS_KEY, STUDY_CATALOG, type MaType, type StudyId } from "../config/chart-config";

export function useIndicatorSettings() {
  const [activeStudies, setActiveStudies] = useState<StudyId[]>(["volume"]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [maLength, setMaLength] = useState(20);
  const [maType, setMaType] = useState<MaType>("SMA");
  const [smoothingLength, setSmoothingLength] = useState(9);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(INDICATOR_SETTINGS_KEY) ?? "null") as {
        activeStudies?: unknown;
        maLength?: unknown;
        maType?: unknown;
        smoothingLength?: unknown;
      } | null;
      if (saved) {
        const validIds = new Set(STUDY_CATALOG.map((indicator) => indicator.id));
        if (Array.isArray(saved.activeStudies)) {
          const active = saved.activeStudies.filter((id): id is StudyId => typeof id === "string" && validIds.has(id as StudyId));
          setActiveStudies(active);
        }
        if (typeof saved.maLength === "number") setMaLength(Math.max(2, Math.min(500, saved.maLength)));
        if (saved.maType === "SMA" || saved.maType === "EMA" || saved.maType === "WMA") setMaType(saved.maType);
        if (typeof saved.smoothingLength === "number") setSmoothingLength(Math.max(1, Math.min(500, saved.smoothingLength)));
      }
    } catch {
      // Giữ cấu hình mặc định khi dữ liệu lưu trữ không hợp lệ.
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem(INDICATOR_SETTINGS_KEY, JSON.stringify({
      activeStudies,
      maLength,
      maType,
      smoothingLength,
    }));
  }, [activeStudies, maLength, maType, settingsLoaded, smoothingLength]);

  return {
    activeStudies,
    setActiveStudies,
    maLength,
    setMaLength,
    maType,
    setMaType,
    smoothingLength,
    setSmoothingLength,
  };
}
