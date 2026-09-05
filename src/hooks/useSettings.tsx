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
  logEvent,
  updateSettings,
  type Settings,
} from "../lib/tauri";

/** 设置保存防抖窗口：`update` 合并写，`commit`（表单整存）立即写。 */
export const SETTINGS_SAVE_DEBOUNCE_MS = 500;

interface SettingsContextValue {
  settings: Settings | null;
  /** 合并式更新：乐观生效，防抖后只把变更字段发往后端 */
  update: (patch: Partial<Settings>) => void;
  /** 显式保存：乐观生效并立即落盘（只发变更字段，吸收挂起补丁），返回 Promise 供表单捕获错误 */
  commit: (patch: Partial<Settings>) => Promise<void>;
  /** 仅本地回显：改内存、永不持久化——用于后端专用命令已持久化、事件回流前的即时展示 */
  mergeLocal: (patch: Partial<Settings>) => void;
  /** 仅同步内存状态（不落盘）——用于 reset 等后端已持久化并返回新值的场景 */
  syncFromBackend: (value: Settings) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * 应用设置 Provider（全局唯一数据源）。
 *
 * 约定：
 * - 跨组件共享的设置状态必须从这里读取，禁止各自加载/持有独立副本；
 * - 持久化只走增量补丁（updateSettings）；watched_dirs / project_dirs 由后端
 *   专用命令写并经 settings-changed 事件回流，前端不得回写（历史 bug 教训）。
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const latestRef = useRef<Settings | null>(null);
  const pendingPatchRef = useRef<Partial<Settings> | null>(null);
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

  /** 冲刷挂起补丁：累积的变更字段一次性发往后端；失败回填待重试并记日志，不回滚乐观态。 */
  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    if (!patch) return;
    pendingPatchRef.current = null;
    try {
      await updateSettings(patch);
    } catch (err) {
      // 回填挂起补丁：保留下次事件冲刷 / commit 吸收的重试机会，避免与后端静默分叉
      pendingPatchRef.current = { ...(pendingPatchRef.current ?? {}), ...patch };
      void logEvent("warn", `ui: 设置防抖落盘失败 ${String(err)}`);
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...(latestRef.current ?? defaultSettings), ...patch };
      latestRef.current = next;
      setSettings(next);
      pendingPatchRef.current = { ...(pendingPatchRef.current ?? {}), ...patch };
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flush();
      }, SETTINGS_SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const commit = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...(latestRef.current ?? defaultSettings), ...patch };
      latestRef.current = next;
      setSettings(next);
      // 吸收挂起补丁一起落盘，避免用户先点开关再保存表单时丢字段
      const merged = { ...(pendingPatchRef.current ?? {}), ...patch };
      pendingPatchRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await updateSettings(merged);
    },
    [],
  );

  const syncFromBackend = useCallback((value: Settings) => {
    latestRef.current = value;
    setSettings(value);
  }, []);

  const mergeLocal = useCallback((patch: Partial<Settings>) => {
    const next = { ...(latestRef.current ?? defaultSettings), ...patch };
    latestRef.current = next;
    setSettings(next);
  }, []);

  // 托盘等外部入口修改设置后同步刷新（如主题快速切换）。
  // 先冲刷本地挂起补丁（其自身落盘也会触发本事件，届时挂起已空），再拉取后端真源，
  // 避免事件刷新覆盖未落盘的乐观修改；刷新失败重试一次，仍失败记日志并保留旧值。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const refetch = (retry: boolean): Promise<void> =>
      getSettings()
        .then((value) => {
          if (cancelled) return;
          latestRef.current = value;
          setSettings(value);
        })
        .catch((err) => {
          if (cancelled) return;
          if (retry) return refetch(false);
          void logEvent("warn", `ui: 设置刷新失败 ${String(err)}`);
        });
    listen<{ keys: string[] }>(APP_EVENTS.settingsChanged, () => {
      void flush().finally(() => {
        void refetch(true);
      });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [flush]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, update, commit, mergeLocal, syncFromBackend }}
    >
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
