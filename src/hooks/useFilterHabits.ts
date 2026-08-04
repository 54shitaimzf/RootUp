import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseFilterHabits,
  touchHabit,
  type FilterHabits,
} from "../lib/filterHabits";
import { getHabits, logEvent, saveHabits } from "../lib/tauri";

const LEGACY_STORAGE_KEY = "rootup.filter-habits.v1";
const SAVE_DEBOUNCE_MS = 800;

/**
 * 筛选使用习惯：由应用数据目录 `habits.json` 管理（Rust 侧读写）。
 * 挂载时加载；touch 更新状态并 800ms 防抖合并写盘；
 * 启动时一次性迁移旧 localStorage 数据（迁移成功即删除旧键）。
 */
export function useFilterHabits() {
  const [habits, setHabits] = useState<FilterHabits>({});
  const latestRef = useRef<FilterHabits>({});
  const timerRef = useRef<number | null>(null);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void saveHabits(latestRef.current).catch(() =>
        void logEvent("warn", "habits: 写入失败"),
      );
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    latestRef.current = habits;
  }, [habits]);

  useEffect(() => {
    let cancelled = false;
    getHabits()
      .then((remote) => {
        if (cancelled) return;
        let merged: FilterHabits = remote;
        try {
          const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyRaw) {
            const legacy = parseFilterHabits(legacyRaw);
            const legacyCount = Object.keys(legacy).length;
            if (legacyCount > 0) {
              merged = { ...legacy, ...remote };
              void saveHabits(merged)
                .then(() => {
                  localStorage.removeItem(LEGACY_STORAGE_KEY);
                  void logEvent(
                    "info",
                    `habits: 迁移 localStorage ${legacyCount} 条`,
                  );
                })
                .catch(() => {});
            } else {
              localStorage.removeItem(LEGACY_STORAGE_KEY);
            }
          }
        } catch {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          void logEvent("warn", "habits: 旧 localStorage 数据损坏已忽略");
        }
        setHabits(merged);
      })
      .catch((err) => {
        if (cancelled) return;
        void logEvent("warn", `habits: 加载失败回退空表: ${String(err)}`);
        setHabits({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const touch = useCallback((key: string) => {
    const next = touchHabit(latestRef.current, key);
    latestRef.current = next;
    setHabits(next);
    scheduleSave();
  }, [scheduleSave]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        if (Object.keys(latestRef.current).length > 0) {
          void saveHabits(latestRef.current).catch(() => {});
        }
      }
    },
    [],
  );

  return { habits, touch };
}
