import { useCallback, useEffect, useState } from "react";
import {
  defaultSettings,
  getSettings,
  saveSettings,
  type Settings,
} from "../lib/tauri";

/** 加载应用设置并提供更新入口（即时生效 + 落盘持久化） */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {
        if (!cancelled) setSettings({ ...defaultSettings });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...(prev ?? defaultSettings), ...patch };
      void saveSettings(next).catch(() => {});
      return next;
    });
  }, []);

  return { settings, update };
}
