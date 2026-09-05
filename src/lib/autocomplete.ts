import { topSuggestions, type FilterHabits } from "./filterHabits";

export type SuggestionKind =
  | "category"
  | "state"
  | "label"
  | "unitKind"
  | "keyword";

/** 一条可插入搜索框的补全建议。 */
export interface Suggestion {
  kind: SuggestionKind;
  /** 习惯键（值与筛选 chips 一致；关键词为 "keyword:<prefix>"） */
  key: string;
  /** 原始键：如 "document" / "高数" / "type:" */
  raw: string;
  /** 完整 token：如 "type:document" / "type:" */
  token: string;
  /** 展示名：类别/状态为翻译名，标签为原文，关键词为通俗说明 */
  display: string;
}

/** 可转为标签的离散建议类型（unitKind = 文件/项目/软件单元类型）。 */
export type DiscreteKind = "category" | "state" | "label" | "unitKind";

export interface TagValue {
  kind: DiscreteKind;
  value: string;
}

export interface InsertionResult {
  text: string;
  caret: number;
  /** 离散建议产生待添加标签；关键词建议为 null */
  tag: TagValue | null;
}

export interface FilterTags {
  categories: string[];
  states: string[];
  labels: string[];
}

/** 标签对应的习惯键（与筛选 chips 共用频率统计）。 */
export function habitKeyForTag(tag: TagValue): string {
  if (tag.kind === "category") return `category:${tag.value}`;
  if (tag.kind === "state") return `state:${tag.value}`;
  if (tag.kind === "unitKind") return `kind:${tag.value}`;
  return `label:${tag.value}`;
}

/**
 * 语法关键词顺序（cat → type → kind → label → state → size → before → after）。
 * cat: 类别（值=类别 key）；type: 精确扩展名；kind: 单元类型（file/project/software）——
 * 三者语义不同，禁止混用（契约见 fixtures/query-grammar-cases.json，权威解释器在后端 core/query.rs）。
 */
export const KEYWORD_PREFIXES = [
  "cat:",
  "type:",
  "kind:",
  "label:",
  "+label:",
  "state:",
  "size:",
  "before:",
  "after:",
] as const;

const PREFIX_TO_KIND: Record<string, DiscreteKind> = {
  "cat:": "category",
  "kind:": "unitKind",
  "label:": "label",
  "state:": "state",
};

const KIND_PREFIX: Record<DiscreteKind, string> = {
  category: "cat:",
  unitKind: "kind:",
  state: "state:",
  label: "label:",
};

export function lastToken(text: string): string {
  return text.trimEnd().split(/\s+/).pop() ?? "";
}

/** 光标所在/前一个 token 的范围（空格分隔）。 */
export function tokenRangeAt(
  text: string,
  caret: number,
): { start: number; end: number; token: string } {
  const clamped = Math.max(0, Math.min(caret, text.length));
  let start = clamped;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = clamped;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, end, token: text.slice(start, end) };
}

function normalizeSpaces(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
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
 * - 空输入：按习惯返回前 N 条值候选（不含关键词）；
 * - 末尾是空格：关键词优先，随后按习惯返回值候选；
 * - token 带 type:/label:/state: 前缀：补该维度值；
 * - token 是关键词前缀：返回匹配的关键词；
 * - 其它：前缀匹配优先于子串匹配，同档内按习惯降序。
 */
export function getSuggestions(
  text: string,
  candidates: Suggestion[],
  habits: FilterHabits,
  limit = 8,
): Suggestion[] {
  if (!text.trim()) {
    return topSuggestions(
      candidates.filter((candidate) => candidate.kind !== "keyword"),
      habits,
      limit,
    );
  }
  if (/\s$/.test(text)) {
    const keywords = candidates.filter(
      (candidate) => candidate.kind === "keyword",
    );
    const values = topSuggestions(
      candidates.filter((candidate) => candidate.kind !== "keyword"),
      habits,
      limit,
    );
    return [...keywords, ...values].slice(0, limit);
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
  const keywords = candidates.filter(
    (candidate) =>
      candidate.kind === "keyword" &&
      candidate.raw.toLowerCase().startsWith(query),
  );
  const values = candidates.filter(
    (candidate) => candidate.kind !== "keyword",
  );
  const prefixMatched = values.filter(
    (candidate) =>
      candidate.raw.toLowerCase().startsWith(query) ||
      candidate.display.toLowerCase().startsWith(query),
  );
  const substringMatched = values.filter(
    (candidate) =>
      !prefixMatched.includes(candidate) &&
      (candidate.raw.toLowerCase().includes(query) ||
        candidate.display.toLowerCase().includes(query)),
  );
  return [
    ...keywords,
    ...topSuggestions(prefixMatched, habits, limit),
    ...topSuggestions(substringMatched, habits, limit),
  ].slice(0, limit);
}

/**
 * 应用建议（光标感知）：
 * - 关键词：替换光标处匹配的片段，否则在光标处插入前缀；
 * - 离散建议：消费光标处“匹配出该建议”的文本片段并返回 tag；
 *   若片段不匹配（如无关文字），仅返回 tag、文本不变。
 */
export function resolveInsertion(
  text: string,
  caret: number,
  suggestion: Suggestion,
): InsertionResult {
  const clamped = Math.max(0, Math.min(caret, text.length));
  const range = tokenRangeAt(text, clamped);

  if (suggestion.kind === "keyword") {
    const lowerToken = range.token.toLowerCase();
    const keyword = suggestion.raw.toLowerCase();
    const matchesToken =
      lowerToken.length > 0 &&
      (keyword.startsWith(lowerToken) || lowerToken.startsWith(keyword));
    if (matchesToken) {
      const next =
        text.slice(0, range.start) + suggestion.token + text.slice(range.end);
      return {
        text: normalizeSpaces(next),
        caret: normalizeSpaces(next).length,
        tag: null,
      };
    }
    const prefix =
      clamped >= text.length && text.trimEnd().length > 0 && !text.endsWith(" ")
        ? " "
        : "";
    const next =
      text.slice(0, clamped) + prefix + suggestion.token + text.slice(clamped);
    return {
      text: next,
      caret: clamped + prefix.length + suggestion.token.length,
      tag: null,
    };
  }

  const lowerToken = range.token.toLowerCase();
  const expectedPrefix = KIND_PREFIX[suggestion.kind];
  const matches =
    lowerToken.length > 0 &&
    (dimensionPrefix(range.token) === expectedPrefix ||
      suggestion.raw.toLowerCase().includes(lowerToken));
  if (matches) {
    const next = text.slice(0, range.start) + text.slice(range.end);
    const normalized = normalizeSpaces(next);
    return {
      text: normalized,
      caret: normalized.length,
      tag: { kind: suggestion.kind, value: suggestion.raw },
    };
  }
  return {
    text,
    caret: clamped,
    tag: { kind: suggestion.kind, value: suggestion.raw },
  };
}

/** 添加标签（重复不生效）。 */
export function addTag(
  tags: FilterTags,
  tag: TagValue,
): { tags: FilterTags; added: boolean } {
  const list =
    tag.kind === "category"
      ? tags.categories
      : tag.kind === "state"
        ? tags.states
        : tags.labels;
  if (list.includes(tag.value)) {
    return { tags, added: false };
  }
  const nextList = [...list, tag.value];
  return {
    tags:
      tag.kind === "category"
        ? { ...tags, categories: nextList }
        : tag.kind === "state"
          ? { ...tags, states: nextList }
          : { ...tags, labels: nextList },
    added: true,
  };
}

/** 删除标签。 */
export function removeTag(tags: FilterTags, tag: TagValue): FilterTags {
  if (tag.kind === "category") {
    return {
      ...tags,
      categories: tags.categories.filter((value) => value !== tag.value),
    };
  }
  if (tag.kind === "state") {
    return {
      ...tags,
      states: tags.states.filter((value) => value !== tag.value),
    };
  }
  return {
    ...tags,
    labels: tags.labels.filter((value) => value !== tag.value),
  };
}

/** Backspace 语义：移除渲染顺序中的最后一个标签（categories → states → labels）。 */
export function removeLastTag(
  tags: FilterTags,
): { tags: FilterTags; removed: TagValue | null } {
  if (tags.labels.length > 0) {
    const value = tags.labels[tags.labels.length - 1];
    return {
      tags: { ...tags, labels: tags.labels.slice(0, -1) },
      removed: { kind: "label", value },
    };
  }
  if (tags.states.length > 0) {
    const value = tags.states[tags.states.length - 1];
    return {
      tags: { ...tags, states: tags.states.slice(0, -1) },
      removed: { kind: "state", value },
    };
  }
  if (tags.categories.length > 0) {
    const value = tags.categories[tags.categories.length - 1];
    return {
      tags: { ...tags, categories: tags.categories.slice(0, -1) },
      removed: { kind: "category", value },
    };
  }
  return { tags, removed: null };
}
