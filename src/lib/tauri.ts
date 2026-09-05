import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { StudyData } from "./studyStore";

export type ThemeMode = "system" | "light" | "dark";
export type Language = "zh-CN" | "en";
export type CloseAction = "ask" | "background" | "quit";

/** 设置 schema 版本（与 Rust 侧 core::settings::CURRENT_VERSION 一致；写入以后端盖章为准）。 */
export const SETTINGS_VERSION = 3;

/** 忽略规则：临时扩展名 / 文件名前缀 / 完整文件名（与后端 IgnoreRules 对应） */
export interface IgnoreRules {
  extensions: string[];
  prefixes: string[];
  exact_names: string[];
}

/** 默认忽略规则（与 fixtures/default-ignore-rules.json 一致；后端为权威来源，前端仅作兜底/预设展示）。 */
export const DEFAULT_IGNORE_RULES: IgnoreRules = {
  extensions: ["crdownload", "part", "download", "tmp", "temp"],
  prefixes: ["~$"],
  exact_names: ["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"],
};

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
  project_dirs: string[];
  preferred_ide: string;
  custom_open_commands: CustomOpenCommand[];
  archive_root: string;
  auto_archive: boolean;
  close_action: CloseAction;
  reminder_enabled: boolean;
  reminder_lead_days: number;
}

/** 用户自定义打开命令（tool 为空 = 通用最后兜底） */
export interface CustomOpenCommand {
  name: string;
  command: string;
  tool: string;
}

/** 项目类型（与 Rust 侧 ProjectKind 对应） */
export type ProjectKind =
  | "rust"
  | "node"
  | "python"
  | "java"
  | "csharp"
  | "go"
  | "unity"
  | "cpp"
  | "php"
  | "ruby"
  | "dart"
  | "flutter"
  | "kotlin"
  | "swift"
  | "android"
  | "generic";

/** 项目信息 */
export interface ProjectInfo {
  path: string;
  name: string;
  kind: ProjectKind;
  /** 手动添加 / 监控目录自动发现 */
  source: "manual" | "auto";
  /** 命中特征文件名（如 Cargo.toml），无识别依据时为 null */
  detectedBy: string | null;
}

/** 打开结果 */
export interface OpenOutcome {
  openedWith: "ide" | "tool" | "explorer" | "default";
  tool: string | null;
  message: string | null;
}

/** 快捷方式创建结果 */
export interface ShortcutOutcome {
  path: string;
  name: string;
  kind: string;
}

/** 与 Rust 侧 core::schemes::RuleScheme 对应 */
export interface RuleScheme {
  id: string;
  name: string;
  ignore_rules: IgnoreRules;
  classify_overrides: ClassifyRule[];
}

/** 与 Rust 侧 core::labels::LabelDef 对应（自定义标签注册表） */
export interface LabelDef {
  key: string;
  name: string;
  icon: string;
  color: string;
}

/** 与 Rust 侧 core::habits::Habit 对应 */
export interface Habit {
  count: number;
  lastUsed: number;
}

/** 筛选使用习惯表（键 → 使用记录），由应用数据目录 habits.json 管理。 */
export type HabitsMap = Record<string, Habit>;

export const defaultSettings: Settings = {
  version: SETTINGS_VERSION,
  theme: "system",
  language: "zh-CN",
  watched_dirs: [],
  ignore_rules: {
    extensions: [...DEFAULT_IGNORE_RULES.extensions],
    prefixes: [...DEFAULT_IGNORE_RULES.prefixes],
    exact_names: [...DEFAULT_IGNORE_RULES.exact_names],
  },
  classify_overrides: [],
  project_dirs: [],
  preferred_ide: "auto",
  custom_open_commands: [],
  archive_root: "",
  auto_archive: false,
  close_action: "ask",
  reminder_enabled: false,
  reminder_lead_days: 3,
};

/** 与 Rust 侧 core::archive::ArchiveBatch 对应 */
export interface ArchiveBatch {
  batchId: number;
  kind: "file" | "project";
  count: number;
  createdAt: number;
  undone: boolean;
  sampleDest: string;
}

/** 与 Rust 侧 core::archive::ArchiveFailure 对应 */
export interface ArchiveFailure {
  path: string;
  error: string;
}

/** 一次成功的移动映射（dest 为后端实际结果，含冲突改名） */
export interface ArchiveMove {
  source: string;
  dest: string;
}

/** 与 Rust 侧 core::archive::ArchiveOutcome 对应 */
export interface ArchiveOutcome {
  batchId: number | null;
  archived: number;
  failed: ArchiveFailure[];
  /** 成功移动的 source→dest 映射，展示以此为准，前端不得自行推导 */
  results: ArchiveMove[];
}

/** 内置扩展名 → 类别映射条目（设置页只读展示） */
export interface ClassifyDefaultEntry {
  extension: string;
  category: string;
}

/**
 * 文件状态（与 Rust 侧 core::events::FileState 对应；真源为 fixtures/app-contracts.json 的 fileStates）。
 * emit/listen 之外的状态字面量一律用此类型收口，禁止散落裸字符串联合。
 */
export const FILE_STATES = [
  "pending",
  "indexed",
  "archived",
  "deleted",
] as const;
export type FileState = (typeof FILE_STATES)[number];

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
  state: FileState;
  /**
   * 统一单元类型（0.8.7 阶段二）：file / project / software。
   * 可选兼容旧序列化；缺省按 file 处理（resolveUnitKind）。
   */
  kind?: "file" | "project" | "software";
}

/** 与 Rust 侧 core::query::QueryPage 对应 */
export interface QueryPage {
  items: FileRecord[];
  /**
   * 精确总数仅在「首页 + 无筛选」查询时返回；其余为 -1 哨兵
   * （后端 COUNT 治理），前端须以 items.length / nextCursor 判断可加载数。
   * 0.8.8 将以显式 totalKnown / hasMore 字段替代哨兵。
   */
  total: number;
  /** keyset 下一页游标；无更多数据为 null */
  nextCursor: string | null;
}

export type SortField = "name" | "type" | "size" | "modified" | "labels";
export type SortDir = "asc" | "desc";

/** 添加监控目录的结果（message 为可选提示，如“升级覆盖”） */
export interface AddDirOutcome {
  message: string | null;
  dir: string;
}

/** 常用目录条目（下载 / 桌面 / 文档）。 */
export interface CommonDirEntry {
  path: string;
  kind: "downloads" | "desktop" | "documents";
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

/**
 * 增量更新设置：只传变更字段（JSON 序列化时 undefined 字段被省略，后端保持不变）。
 * watched_dirs / project_dirs / version 不可经此修改（类型层已禁止）——
 * 目录必须走 addWatchedDir / removeWatchedDir 等专用命令，version 由后端盖章。
 */
export function updateSettings(
  patch: Partial<Omit<Settings, "watched_dirs" | "project_dirs" | "version">>,
): Promise<void> {
  return invoke<void>("update_settings", { patch });
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

export function countUnderRoot(root: string): Promise<number> {
  return invoke<number>("count_under_root", { root });
}

export function resolveDirTarget(path: string): Promise<string> {
  return invoke<string>("resolve_dir_target", { path });
}

export function listCommonDirs(): Promise<CommonDirEntry[]> {
  return invoke<CommonDirEntry[]>("list_common_dirs");
}

/** 原生目录选择器；取消返回 null。 */
export async function openDirectoryDialog(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export function listWatchedDirs(): Promise<string[]> {
  return invoke<string[]>("list_watched_dirs");
}

export interface WatchedDirHealth {
  dir: string;
  exists: boolean;
}

export function watchedDirHealth(): Promise<WatchedDirHealth[]> {
  return invoke<WatchedDirHealth[]>("watched_dir_health");
}

/** 结构化查询（搜索语法 + 分页 + 总数） */
export function queryFiles(
  query: string,
  limit: number,
  offset: number,
  sortBy?: SortField | null,
  sortDir?: SortDir,
  cursor?: string | null,
): Promise<QueryPage> {
  return invoke<QueryPage>("query_files", {
    query: query || null,
    limit,
    offset,
    sortBy: sortBy ?? null,
    sortDir: sortDir ?? "desc",
    cursor: cursor ?? null,
  });
}

export function listLabels(): Promise<string[]> {
  return invoke<string[]>("list_labels");
}

export function listCategories(): Promise<string[]> {
  return invoke<string[]>("list_categories");
}

export function listLabelDefs(): Promise<LabelDef[]> {
  return invoke<LabelDef[]>("list_label_defs");
}

export function saveLabelDef(def: LabelDef): Promise<LabelDef> {
  return invoke<LabelDef>("save_label_def", { def });
}

export function deleteLabelDef(key: string): Promise<void> {
  return invoke<void>("delete_label_def", { key });
}

export function archiveFiles(paths: string[]): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>("archive_files", { paths });
}

export function archiveFiltered(query: string): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>("archive_filtered", { query });
}

export function archiveProject(path: string): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>("archive_project", { path });
}

export function undoArchive(batchId: number): Promise<ArchiveOutcome> {
  return invoke<ArchiveOutcome>("undo_archive", { batchId });
}

export function listArchiveBatches(limit: number): Promise<ArchiveBatch[]> {
  return invoke<ArchiveBatch[]>("list_archive_batches", { limit });
}

/** 归档根安全评估结果：level 决定展示与交互强度，reason 映射 i18n。 */
export interface ArchiveAssessment {
  level: "safe" | "warn" | "blocked";
  reason: string | null;
}

/** 归档根安全评估（只读）：规则真源在后端 core/archive_guard。 */
export function assessArchiveRoot(path: string): Promise<ArchiveAssessment> {
  return invoke<ArchiveAssessment>("assess_archive_root", { path });
}

/** 推荐归档位置候选（用户核心目录下的专用子目录）。 */
export function recommendedArchiveRoots(): Promise<string[]> {
  return invoke<string[]>("recommended_archive_roots");
}

/** 课程概览：相关文件（课程标签命中）与相关项目（课程名/别名命中）。 */
export interface CourseOverview {
  files: FileRecord[];
  projects: FileRecord[];
}

export function courseOverview(courseId: string): Promise<CourseOverview> {
  return invoke<CourseOverview>("course_overview", { courseId });
}

/** 内置扩展名映射表（只读，单一来源在后端） */
export function listClassifyDefaults(): Promise<ClassifyDefaultEntry[]> {
  return invoke<ClassifyDefaultEntry[]>("list_classify_defaults");
}

export function scanAll(): Promise<void> {
  return invoke<void>("scan_all");
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

export function listProjects(): Promise<ProjectInfo[]> {
  return invoke<ProjectInfo[]>("list_projects");
}

/** 首次启动深链意图（kind: project 带路径 / homework 直达作业视图） */
export type StartupIntent =
  | { kind: "project"; path: string }
  | { kind: "homework" };

export function takeStartupIntent(): Promise<StartupIntent | null> {
  return invoke<StartupIntent | null>("take_startup_intent");
}

/** 前端加载完成通知：后端据此启动延迟服务（监听/扫描/自动归档/托盘）。 */
export function appReady(): Promise<void> {
  return invoke<void>("app_ready");
}

export function addProjectDir(dir: string): Promise<void> {
  return invoke<void>("add_project_dir", { dir });
}

export function removeProjectDir(dir: string): Promise<void> {
  return invoke<void>("remove_project_dir", { dir });
}

export function openProject(path: string): Promise<OpenOutcome> {
  return invoke<OpenOutcome>("open_project", { path });
}

export function openProjectFromFile(filePath: string): Promise<OpenOutcome> {
  return invoke<OpenOutcome>("open_project_from_file", { filePath });
}

export function openFile(path: string): Promise<OpenOutcome> {
  return invoke<OpenOutcome>("open_file", { path });
}

export function revealInExplorer(path: string): Promise<void> {
  return invoke<void>("reveal_in_explorer", { path });
}

export function createProjectShortcut(path: string): Promise<ShortcutOutcome> {
  return invoke<ShortcutOutcome>("create_project_shortcut", { path });
}

export function createHomeworkShortcut(): Promise<ShortcutOutcome> {
  return invoke<ShortcutOutcome>("create_homework_shortcut");
}

export function listDetectedTools(): Promise<string[]> {
  return invoke<string[]>("list_detected_tools");
}

export function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

/** 学业数据：后端 study.json 统一管理（不再使用 localStorage）。*/
export function getStudyData(): Promise<StudyData> {
  return invoke<StudyData>("get_study_data");
}

export function saveStudyData(data: StudyData): Promise<StudyData> {
  return invoke<StudyData>("save_study_data", { data });
}

export function studyStoreExists(): Promise<boolean> {
  return invoke<boolean>("study_store_exists");
}

export function reapplyStudyLabels(): Promise<number> {
  return invoke<number>("reapply_study_labels");
}
