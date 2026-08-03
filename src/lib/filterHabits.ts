/** 筛选习惯：每个筛选项的点击次数与最近使用时间（存 localStorage，仅本机）。 */
export interface FilterHabit {
  count: number;
  lastUsed: number;
}

export type FilterHabits = Record<string, FilterHabit>;

/** 点击一次：计数 +1 并刷新最近使用时间。 */
export function touchHabit(
  habits: FilterHabits,
  key: string,
  now = Date.now(),
): FilterHabits {
  const prev = habits[key];
  return {
    ...habits,
    [key]: { count: (prev?.count ?? 0) + 1, lastUsed: now },
  };
}

/**
 * 排序规则：key 为 "all" 永远最前 → 已选其次 →
 * count 降序 → lastUsed 降序 → 保持原始顺序（稳定排序兜底）。
 */
export function sortFilterItems<T extends { key: string }>(
  items: T[],
  habits: FilterHabits,
  selectedKeys: string[] = [],
): T[] {
  const selected = new Set(selectedKeys);
  const score = (item: T) => habits[item.key]?.count ?? 0;
  const last = (item: T) => habits[item.key]?.lastUsed ?? 0;
  return [...items].sort((a, b) => {
    if (a.key === "all") return -1;
    if (b.key === "all") return 1;
    const aSel = selected.has(a.key) ? 1 : 0;
    const bSel = selected.has(b.key) ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return last(b) - last(a);
  });
}

/** 按习惯取前 N 项（无已选语义，纯粹频率排序）。 */
export function topSuggestions<T extends { key: string }>(
  items: T[],
  habits: FilterHabits,
  limit: number,
): T[] {
  return sortFilterItems(items, habits, []).slice(0, limit);
}

/**
 * 解析 localStorage 中的习惯数据：
 * 空串/缺失返回空对象；非法 JSON 或结构错误抛出异常（调用方回退并记日志）。
 */
export function parseFilterHabits(raw: string | null): FilterHabits {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("filter habits: 结构非法");
  }
  const out: FilterHabits = {};
  for (const [key, value] of Object.entries(parsed)) {
    const habit = value as { count?: unknown; lastUsed?: unknown };
    if (
      typeof habit?.count === "number" &&
      Number.isFinite(habit.count) &&
      typeof habit?.lastUsed === "number"
    ) {
      out[key] = { count: habit.count, lastUsed: habit.lastUsed };
    }
  }
  return out;
}
