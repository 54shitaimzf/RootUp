import type { HelpSearchSource } from "./helpContent";

export interface HelpSearchResult {
  id: string;
  tab: HelpSearchSource["tab"];
  /** 越小越靠前：0 标题、1 关键词、2 摘要 */
  score: number;
}

const SCORE_TITLE = 0;
const SCORE_KEYWORD = 1;
const SCORE_SUMMARY = 2;

export function normalizeHelpQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * 纯函数帮助搜索：标题命中 > 关键词命中 > 摘要命中，同分按 id 稳定排序。
 * resolve 由调用方注入（如 i18n 的 t），保证本模块可独立测试。
 */
export function searchHelp(
  query: string,
  resolve: (key: string) => string,
  sources: HelpSearchSource[],
): HelpSearchResult[] {
  const normalized = normalizeHelpQuery(query);
  if (!normalized) return [];

  const results: HelpSearchResult[] = [];
  for (const source of sources) {
    const title = resolve(source.titleKey).toLowerCase();
    const summary = source.summaryKey
      ? resolve(source.summaryKey).toLowerCase()
      : "";
    let score: number | null = null;
    if (title.includes(normalized)) {
      score = SCORE_TITLE;
    } else if (
      source.keywords.some(
        (keyword) =>
          keyword.toLowerCase().includes(normalized) ||
          normalized.includes(keyword.toLowerCase()),
      )
    ) {
      score = SCORE_KEYWORD;
    } else if (summary.includes(normalized)) {
      score = SCORE_SUMMARY;
    }
    if (score !== null) {
      results.push({ id: source.id, tab: source.tab, score });
    }
  }

  results.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return results;
}
