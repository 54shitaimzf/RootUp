import { invoke } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";
export type Language = "zh-CN" | "en";

/** 与 Rust 侧 core::settings::Settings 一一对应 */
export interface Settings {
  theme: ThemeMode;
  language: Language;
}

export const defaultSettings: Settings = {
  theme: "system",
  language: "zh-CN",
};

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
