import { useEffect, useState } from "react";
import { INDICATOR_SETTINGS_KEY, type MaType, type StudyId } from "../config/chart-config";

export function useIndicatorSettings() {
  const [activeStudies, setActiveStudies] = useState<StudyId[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [maLength, setMaLength] = useState(20);
  const [maType, setMaType] = useState<MaType>("SMA");
  const [smoothingLength, setSmoothingLength] = useState(9);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(INDICATOR_SETTINGS_KEY) ?? "null") as {
        maLength?: unknown;
        maType?: unknown;
        smoothingLength?: unknown;
      } | null;
      if (saved) {
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
      maLength,
      maType,
      smoothingLength,
    }));
  }, [maLength, maType, settingsLoaded, smoothingLength]);

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
