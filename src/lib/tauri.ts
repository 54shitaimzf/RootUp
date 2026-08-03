import { invoke } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";
export type Language = "zh-CN" | "en";

/** 忽略规则：临时扩展名 / 文件名前缀 / 完整文件名（与后端 IgnoreRules 对应） */
export interface IgnoreRules {
  extensions: string[];
  prefixes: string[];
  exact_names: string[];
}

/** 分类覆盖规则（与后端 ClassifyRule 对应） */
export interface ClassifyRule {
  extensions: string[];
  category: string;
}

/** 与 Rust 侧 core::settings::Settings 一一对应 */
export interface Settings {
  version: number;
  theme: ThemeMode;
  language: Language;
  watched_dirs: string[];
  ignore_rules: IgnoreRules;
  classify_overrides: ClassifyRule[];
}

/** 与 Rust 侧 core::schemes::RuleScheme 对应 */
export interface RuleScheme {
  id: string;
  name: string;
  ignore_rules: IgnoreRules;
  classify_overrides: ClassifyRule[];
}

/** 与 Rust 侧 core::habits::Habit 对应 */
export interface Habit {
  count: number;
  lastUsed: number;
}

/** 筛选使用习惯表（键 → 使用记录），由应用数据目录 habits.json 管理。 */
export type HabitsMap = Record<string, Habit>;

export const defaultSettings: Settings = {
  version: 1,
  theme: "system",
  language: "zh-CN",
  watched_dirs: [],
  ignore_rules: {
    extensions: ["crdownload", "part", "download", "tmp", "temp"],
    prefixes: ["~$"],
    exact_names: ["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"],
  },
  classify_overrides: [],
};

/** 内置扩展名 → 类别映射条目（设置页只读展示） */
export interface ClassifyDefaultEntry {
  extension: string;
  category: string;
}

/** 与 Rust 侧 core::index::FileRecord 对应 */
export interface FileRecord {
  id: number;
  path: string;
  name: string;
  size: number;
  file_type: string;
  labels: string;
  first_seen: number;
  modified: number;
  state: "pending" | "indexed" | "archived" | "deleted";
}

/** 与 Rust 侧 core::query::QueryPage 对应 */
export interface QueryPage {
  items: FileRecord[];
  total: number;
}

/** 添加监控目录的结果（message 为可选提示，如“升级覆盖”） */
export interface AddDirOutcome {
  message: string | null;
  dir: string;
}

export interface ScanProgress {
  dir: string;
  discovered: number;
  processed: number;
  ignored: number;
  errors: number;
}

export interface ScanSummary {
  dir: string;
  discovered: number;
  added: number;
  updated: number;
  ignored: number;
  errors: number;
  missingDeleted: number;
  elapsedMs: number;
  filesPerSec: number;
  cancelled: boolean;
}

export type ScanEventPayload =
  | { type: "progress"; progress: ScanProgress }
  | { type: "finished"; summary: ScanSummary }
  | { type: "cancelled"; summary: ScanSummary }
  | { type: "failed"; dir: string; error: string };

export interface ScanStatus {
  active: boolean;
  dir: string | null;
  discovered: number;
  processed: number;
  ignored: number;
  errors: number;
  queued: number;
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

/** 恢复默认设置（保留监控目录），返回新设置 */
export function resetSettings(): Promise<Settings> {
  return invoke<Settings>("reset_settings");
}

export function listSchemes(): Promise<RuleScheme[]> {
  return invoke<RuleScheme[]>("list_schemes");
}

export function saveScheme(
  name: string,
  ignoreRules: IgnoreRules,
  classifyOverrides: ClassifyRule[],
): Promise<RuleScheme> {
  return invoke<RuleScheme>("save_scheme", { name, ignoreRules, classifyOverrides });
}

export function renameScheme(id: string, name: string): Promise<void> {
  return invoke<void>("rename_scheme", { id, name });
}

export function deleteScheme(id: string): Promise<void> {
  return invoke<void>("delete_scheme", { id });
}

export function getHabits(): Promise<HabitsMap> {
  return invoke<HabitsMap>("get_habits");
}

export function saveHabits(habits: HabitsMap): Promise<void> {
  return invoke<void>("save_habits", { habits });
}

export function addWatchedDir(dir: string): Promise<AddDirOutcome> {
  return invoke<AddDirOutcome>("add_watched_dir", { dir });
}

export function removeWatchedDir(dir: string): Promise<void> {
  return invoke<void>("remove_watched_dir", { dir });
}

export function listWatchedDirs(): Promise<string[]> {
  return invoke<string[]>("list_watched_dirs");
}

/** 结构化查询（搜索语法 + 分页 + 总数） */
export function queryFiles(
  query: string,
  limit: number,
  offset: number,
): Promise<QueryPage> {
  return invoke<QueryPage>("query_files", {
    query: query || null,
    limit,
    offset,
  });
}

/** 兼容旧调用：仅返回列表 */
export function listFiles(query?: string, limit?: number): Promise<FileRecord[]> {
  return invoke<FileRecord[]>("list_files", {
    query: query || null,
    limit: limit ?? null,
  });
}

export function listLabels(): Promise<string[]> {
  return invoke<string[]>("list_labels");
}

export function listCategories(): Promise<string[]> {
  return invoke<string[]>("list_categories");
}

/** 内置扩展名映射表（只读，单一来源在后端） */
export function listClassifyDefaults(): Promise<ClassifyDefaultEntry[]> {
  return invoke<ClassifyDefaultEntry[]>("list_classify_defaults");
}

export function scanAll(): Promise<void> {
  return invoke<void>("scan_all");
}

export function scanNow(dir: string): Promise<void> {
  return invoke<void>("scan_now", { dir });
}

export function cancelScan(): Promise<void> {
  return invoke<void>("cancel_scan");
}

export function getScanStatus(): Promise<ScanStatus | null> {
  return invoke<ScanStatus | null>("get_scan_status");
}

export function getLogDir(): Promise<string> {
  return invoke<string>("get_log_dir");
}

export function logEvent(
  level: "debug" | "info" | "warn" | "error",
  message: string,
): Promise<void> {
  return invoke<void>("log_event", { level, message });
}

/** 关闭确认弹窗中选择“后台运行” */
export function hideToTray(): Promise<void> {
  return invoke<void>("hide_to_tray");
}

/** 关闭确认弹窗中选择“退出程序” */
export function quitApp(): Promise<void> {
  return invoke<void>("quit_app");
}
