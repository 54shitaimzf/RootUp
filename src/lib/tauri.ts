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

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

export function addWatchedDir(dir: string): Promise<void> {
  return invoke<void>("add_watched_dir", { dir });
}

export function removeWatchedDir(dir: string): Promise<void> {
  return invoke<void>("remove_watched_dir", { dir });
}

export function listWatchedDirs(): Promise<string[]> {
  return invoke<string[]>("list_watched_dirs");
}

export function listFiles(query?: string, limit?: number): Promise<FileRecord[]> {
  return invoke<FileRecord[]>("list_files", {
    query: query || null,
    limit: limit ?? null,
  });
}

export function logEvent(
  level: "debug" | "info" | "warn" | "error",
  message: string,
): Promise<void> {
  return invoke<void>("log_event", { level, message });
}

/** 关闭确认弹窗中选择"后台运行" */
export function hideToTray(): Promise<void> {
  return invoke<void>("hide_to_tray");
}

/** 关闭确认弹窗中选择"退出程序" */
export function quitApp(): Promise<void> {
  return invoke<void>("quit_app");
}
