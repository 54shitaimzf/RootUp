import type { Language } from "./tauri";

/** 语言注册表（单一来源）：新增语言 = 前端字典 + 本表 + 后端 Language 白名单三处同步。 */
export interface LanguageOption {
  value: Language;
  labelKey: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "zh-CN", labelKey: "settings.languageZh" },
  { value: "en", labelKey: "settings.languageEn" },
];

export const LANGUAGE_VALUES: readonly Language[] = LANGUAGE_OPTIONS.map(
  (option) => option.value,
);
