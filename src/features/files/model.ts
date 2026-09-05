import type { TFunction } from "i18next";
import {
  fileStateMeta,
  formatFileSizeParts,
  parseLabels,
  sortLabelsByPriority,
  type FileStateMeta,
} from "../../lib/fileUtils";
import {
  KEYWORD_PREFIXES,
  type Suggestion,
} from "../../lib/autocomplete";
import type { FileRecord } from "../../lib/tauri";

/** 文件页分页大小（与后端 query_files limit 上限内的默认体验一致）。 */
export const PAGE_SIZE = 50;

/** 虚拟列表固定行高（与现有行 py-3 单行形态一致）。 */
export const FILE_ROW_HEIGHT = 56;

/** 超过该数量启用虚拟滚动，小列表保持原渲染（布局不变）。 */
export const VIRTUAL_ROW_THRESHOLD = 200;

/** 代码/文本扩展名集合：「用 IDE 打开」的展示条件。 */
export const CODE_EDITOR_EXTENSIONS = new Set([
  "rs",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "go",
  "java",
  "kt",
  "kts",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "cc",
  "php",
  "rb",
  "swift",
  "dart",
  "sh",
  "bat",
  "cmd",
  "ps1",
  "toml",
  "yml",
  "yaml",
  "json",
  "xml",
  "sql",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
  "md",
  "txt",
  "tex",
  "zig",
  "lua",
  "r",
]);

export function canIdeOpen(fileType: string): boolean {
  return CODE_EDITOR_EXTENSIONS.has(fileType.toLowerCase());
}

/** 自动补全关键字的展示文案 key。 */
export const KEYWORD_DISPLAY_KEY: Record<string, string> = {
  "cat:": "files.acKeywordCategory",
  "type:": "files.acKeywordType",
  "kind:": "files.acKeywordKind",
  "label:": "files.acKeywordLabel",
  "+label:": "files.acKeywordLabelAll",
  "state:": "files.acKeywordState",
  "size:": "files.acKeywordSize",
  "before:": "files.acKeywordBefore",
  "after:": "files.acKeywordAfter",
};

/** kind: 维度的固定值候选（与后端 UnitKind 一致）。 */
const UNIT_KIND_TOKENS = ["file", "project", "software"] as const;

/** 标签展示所需的最小注册表形态（自定义标签 ∪ 课程标签）。 */
export type LabelDefLike = { key: string; name: string; icon: string; color: string };

/** 构建搜索自动补全候选（关键字 + 类别 + 状态 + 标签）。 */
export function buildAutocompleteCandidates(opts: {
  categories: string[];
  orderedAvailableLabels: string[];
  mergedLabelDefs: Record<string, LabelDefLike>;
  t: TFunction;
}): Suggestion[] {
  const { categories, orderedAvailableLabels, mergedLabelDefs, t } = opts;
  const stateLabel = (state: string) =>
    t(`filter.state${state[0].toUpperCase()}${state.slice(1)}`);
  const keywords = KEYWORD_PREFIXES.map((prefix) => ({
    kind: "keyword" as const,
    key: `keyword:${prefix}`,
    raw: prefix,
    token: prefix,
    display: t(KEYWORD_DISPLAY_KEY[prefix]),
  }));
  return [
    ...keywords,
    ...categories.map((category) => ({
      kind: "category" as const,
      key: `category:${category}`,
      raw: category,
      token: `cat:${category}`,
      display: t(`filter.${category}`),
    })),
    ...UNIT_KIND_TOKENS.map((unitKind) => ({
      kind: "unitKind" as const,
      key: `unitKind:${unitKind}`,
      raw: unitKind,
      token: `kind:${unitKind}`,
      display: t(`filter.${unitKind === "file" ? "file" : unitKind}`),
    })),
    ...FILTER_STATE_TOKENS.map((state) => ({
      kind: "state" as const,
      key: `state:${state}`,
      raw: state,
      token: `state:${state}`,
      display: stateLabel(state),
    })),
    ...orderedAvailableLabels.map((label) => ({
      kind: "label" as const,
      key: `label:${label}`,
      raw: label,
      token: `label:${label}`,
      display: mergedLabelDefs[label]?.name ?? label,
    })),
  ];
}

/** 自动补全状态候选（与 lib/fileUtils 的状态筛选选项一致）。 */
const FILTER_STATE_TOKENS = ["pending", "indexed"];

/** 文件行的展示派生结果（FileRow 只渲染，不再做派生）。 */
export interface RowPresentation {
  meta: FileStateMeta;
  /** 行首图标的类别 key（首个标签，未知回落 other）。 */
  iconCategory: string;
  /** 去重 + 课程优先排序后的标签 key 列表。 */
  sortedLabels: string[];
  firstDef?: LabelDefLike;
  firstName: string;
  sizeParts: { value: string; unit: string };
  canIdeOpen: boolean;
}

/**
 * 从文件记录派生行展示信息：
 * 标签按显示名去重（大小写不敏感）、课程标签优先，未知标签回退原文。
 */
export function presentRow(
  file: FileRecord,
  mergedLabelDefs: Record<string, LabelDefLike>,
  courseLabelDefs: Record<string, LabelDefLike>,
  t: TFunction,
): RowPresentation {
  const fileLabels = parseLabels(file.labels);
  const seen = new Set<string>();
  const dedupedLabels: string[] = [];
  for (const key of fileLabels) {
    const name = mergedLabelDefs[key]
      ? mergedLabelDefs[key].name
      : t(`filter.${key}`, key);
    const norm = name.trim().toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      dedupedLabels.push(key);
    }
  }
  const sortedLabels = sortLabelsByPriority(
    dedupedLabels,
    (key) => key in courseLabelDefs,
  );
  const firstLabel = sortedLabels[0];
  const firstDef = firstLabel ? mergedLabelDefs[firstLabel] : undefined;
  const firstName = firstLabel
    ? firstDef
      ? firstDef.name
      : t(`filter.${firstLabel}`, firstLabel)
    : "";
  return {
    meta: fileStateMeta(file.state),
    iconCategory: fileLabels[0] ?? "other",
    sortedLabels,
    firstDef,
    firstName,
    sizeParts: formatFileSizeParts(file.size),
    canIdeOpen: canIdeOpen(file.file_type),
  };
}
