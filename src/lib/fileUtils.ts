import type { FileRecord } from "./tauri";

/** 筛选器组合参数（新手路径：点选 → 生成查询串） */
export interface QueryParts {
  text?: string;
  types?: string[];
  states?: string[];
  labels?: string[];
}

/** 状态筛选固定选项（与后端 state 查询一致）。 */
export const FILTER_STATE_OPTIONS = ["pending", "indexed"] as const;

/** 将筛选器状态组合为搜索语法字符串（后端 query_files 解析） */
export function buildQuery(parts: QueryParts): string {
  const tokens: string[] = [];
  const text = parts.text?.trim();
  if (text) tokens.push(text);
  for (const type of parts.types ?? []) tokens.push(`type:${type}`);
  for (const state of parts.states ?? []) tokens.push(`state:${state}`);
  for (const label of parts.labels ?? []) tokens.push(`label:${label}`);
  // 自动补全插入的 token 与 chips 点选可能重复，按原文去重。
  return [...new Set(tokens)].join(" ");
}

/** 解析逗号分隔的标签字段为数组 */
export function parseLabels(labels: string): string[] {
  return [
    ...new Set(
      labels
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
}

/** 标签展示优先级：课程标签在前、通用标签在后，组内保持原顺序。 */
export function sortLabelsByPriority(
  labels: string[],
  isCourse: (key: string) => boolean,
): string[] {
  return [
    ...labels.filter((key) => isCourse(key)),
    ...labels.filter((key) => !isCourse(key)),
  ];
}

/** 按名称/路径过滤（大小写不敏感）。 */
export function filterFiles(files: FileRecord[], query: string): FileRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter(
    (f) =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
  );
}

/**
 * 合并实时批次到现有列表：
 * - state=deleted 的记录从列表移除
 * - 其余按 path upsert
 * - 按 modified 倒序并截断
 */
export function mergeFiles(
  prev: FileRecord[],
  incoming: FileRecord[],
  limit = 200,
): FileRecord[] {
  const map = new Map<string, FileRecord>(prev.map((f) => [f.path, f]));
  for (const rec of incoming) {
    if (rec.state === "deleted") {
      map.delete(rec.path);
    } else {
      map.set(rec.path, rec);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.modified - a.modified)
    .slice(0, limit);
}

/** “加载更多”语义：新页追加到已有列表，上限为已加载总量（offset + limit）。 */
export function loadMoreMerge(
  prev: FileRecord[],
  incoming: FileRecord[],
  cap: number,
): FileRecord[] {
  return mergeFiles(prev, incoming, cap);
}

/** 状态徽标元数据（文案 key 与颜色类分离，便于主题/皮肤调整）。 */
export interface FileStateMeta {
  labelKey: string;
  dotClass: string;
}

export function fileStateMeta(state: FileRecord["state"]): FileStateMeta {
  switch (state) {
    case "pending":
      return { labelKey: "files.statePending", dotClass: "bg-amber-400" };
    case "indexed":
      return { labelKey: "files.stateIndexed", dotClass: "bg-brand-500" };
    case "archived":
      return { labelKey: "files.stateArchived", dotClass: "bg-sky-500" };
    case "deleted":
      return { labelKey: "files.stateDeleted", dotClass: "bg-slate-400" };
  }
}

/** 人类可读的文件大小。 */
export function formatFileSizeParts(bytes: number): {
  value: string;
  unit: string;
} {
  if (!Number.isFinite(bytes) || bytes < 0) return { value: "—", unit: "" };
  if (bytes < 1024) return { value: String(bytes), unit: "B" };
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  const text = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return { value: text, unit };
}

/** 人类可读的文件大小（数字 + 单位合并文本）。 */
export function formatFileSize(bytes: number): string {
  const parts = formatFileSizeParts(bytes);
  return parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
}

/** 毫秒时间戳 → 本地可读时间。 */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
