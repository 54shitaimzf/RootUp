import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { APP_EVENTS } from "../lib/events";
import {
  defaultSettings,
  getSettings,
  updateSettings,
  type Settings,
} from "../lib/tauri";

/** 设置保存防抖窗口：`update` 合并写，`replace`（表单整存）立即写。 */
export const SETTINGS_SAVE_DEBOUNCE_MS = 500;

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
  const latestRef = useRef<Settings | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((value) => {
        if (!cancelled) {
          latestRef.current = value;
          setSettings(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          latestRef.current = { ...defaultSettings };
          setSettings({ ...defaultSettings });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 托盘等外部入口修改设置后同步刷新（如主题快速切换）。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<null>(APP_EVENTS.settingsChanged, () => {
      getSettings()
        .then((value) => {
          latestRef.current = value;
          setSettings(value);
        })
        .catch(() => {});
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...(latestRef.current ?? defaultSettings), ...patch };
    latestRef.current = next;
    setSettings(next);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const snapshot = latestRef.current;
      if (snapshot) {
        void updateSettings(snapshot).catch(() => {});
      }
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }, []);

  const replace = useCallback((next: Settings) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    latestRef.current = next;
    setSettings(next);
    return updateSettings(next);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
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
