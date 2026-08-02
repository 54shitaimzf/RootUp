import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  defaultSettings,
  getSettings,
  saveSettings,
  type Settings,
} from "../lib/tauri";

interface SettingsContextValue {
  settings: Settings | null;
  /** 合并式更新：即时生效并落盘持久化 */
  update: (patch: Partial<Settings>) => void;
  /** 整体替换：同步内存状态并落盘，返回 Promise 供调用方捕获错误 */
  replace: (next: Settings) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * 应用设置 Provider（全局唯一数据源）。
 *
 * 约定：跨组件共享的设置状态必须从这里读取，
 * 禁止在多个组件里各自加载/持有独立副本。
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
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

  const replace = useCallback((next: Settings) => {
    setSettings(next);
    return saveSettings(next);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, replace }}>
      {children}
    </SettingsContext.Provider>
  );
}

/** 读取全局设置；必须在 SettingsProvider 内使用。 */
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings 必须在 SettingsProvider 内使用");
  }
  return ctx;
}
