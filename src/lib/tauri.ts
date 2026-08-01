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

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

/** 关闭确认弹窗中选择"后台运行" */
export function hideToTray(): Promise<void> {
  return invoke<void>("hide_to_tray");
}

/** 关闭确认弹窗中选择"退出程序" */
export function quitApp(): Promise<void> {
  return invoke<void>("quit_app");
}
