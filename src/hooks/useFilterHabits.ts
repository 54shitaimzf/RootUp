import { useCallback, useState } from "react";
import {
  parseFilterHabits,
  touchHabit,
  type FilterHabits,
} from "../lib/filterHabits";
import { logEvent } from "../lib/tauri";

const STORAGE_KEY = "rootup.filter-habits.v1";

function load(): FilterHabits {
  try {
    return parseFilterHabits(localStorage.getItem(STORAGE_KEY));
  } catch {
    void logEvent("warn", "filter: 习惯数据损坏已回退");
    return {};
  }
}

/** 筛选使用习惯：读取/计数/持久化，FilePage 单实例共享。 */
export function useFilterHabits() {
  const [habits, setHabits] = useState<FilterHabits>(load);

  const touch = useCallback((key: string) => {
    setHabits((prev) => {
      const next = touchHabit(prev, key);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        void logEvent("warn", "filter: 习惯数据写入失败");
      }
      return next;
    });
  }, []);

  return { habits, touch };
}
