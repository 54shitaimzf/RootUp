import { topSuggestions, type FilterHabits } from "./filterHabits";

export type SuggestionKind = "category" | "state" | "label";

/** 一条可插入搜索框的补全建议。 */
export interface Suggestion {
  kind: SuggestionKind;
  /** 习惯键（与筛选 chips 一致）：如 "category:document" / "label:高数" */
  key: string;
  /** 原始键：如 "document" / "pending" / "高数"（用于匹配与 token） */
  raw: string;
  /** 插入搜索框的完整 token：如 "type:document" */
  token: string;
  /** 展示名：类别/状态为翻译名，标签为原文 */
  display: string;
}

const PREFIX_TO_KIND: Record<string, SuggestionKind> = {
  "type:": "category",
  "label:": "label",
  "state:": "state",
};

function lastToken(text: string): string {
  return text.trimEnd().split(/\s+/).pop() ?? "";
}

function dimensionPrefix(token: string): string | null {
  const lower = token.toLowerCase();
  for (const prefix of Object.keys(PREFIX_TO_KIND)) {
    if (lower.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * 补全建议：
 * - 空输入：按使用习惯返回前 limit 条；
 * - 末尾 token 以 type:/label:/state: 开头：只补全对应维度；
 * - 其余：对键与展示名做大小写不敏感子串匹配。
 * 匹配结果均按使用习惯排序后截断。
 */
export function getSuggestions(
  text: string,
  candidates: Suggestion[],
  habits: FilterHabits,
  limit = 8,
): Suggestion[] {
  if (!text.trim()) {
    return topSuggestions(candidates, habits, limit);
  }
  const token = lastToken(text);
  const prefix = dimensionPrefix(token);
  if (prefix) {
    const kind = PREFIX_TO_KIND[prefix];
    const rest = token.slice(prefix.length).trim().toLowerCase();
    const pool = candidates.filter((candidate) => candidate.kind === kind);
    const matched = rest
      ? pool.filter(
          (candidate) =>
            candidate.raw.toLowerCase().includes(rest) ||
            candidate.display.toLowerCase().includes(rest),
        )
      : pool;
    return topSuggestions(matched, habits, limit);
  }
  const query = token.toLowerCase();
  const matched = candidates.filter(
    (candidate) =>
      candidate.raw.toLowerCase().includes(query) ||
      candidate.display.toLowerCase().includes(query),
  );
  return topSuggestions(matched, habits, limit);
}

/**
 * 将建议插入搜索文本：
 * 末尾 token 与建议同维度前缀时替换该 token，否则追加到末尾。
 */
export function applySuggestion(text: string, suggestion: Suggestion): string {
  const trimmed = text.trimEnd();
  const token = lastToken(trimmed);
  const prefix = dimensionPrefix(token);
  if (prefix && PREFIX_TO_KIND[prefix] === suggestion.kind) {
    const head = trimmed.slice(0, trimmed.length - token.length);
    return `${head}${suggestion.token}`.trim();
  }
  return trimmed ? `${trimmed} ${suggestion.token}` : suggestion.token;
}
