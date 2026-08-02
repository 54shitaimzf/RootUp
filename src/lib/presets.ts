import type { ClassifyRule, IgnoreRules, Settings } from "./tauri";

/** 规则模板：套用即替换忽略规则与分类覆盖，不影响主题/语言/监控目录。 */
export interface RulePreset {
  id: string;
  nameKey: string;
  ignoreRules: IgnoreRules;
  classifyOverrides: ClassifyRule[];
}

const DEFAULT_IGNORE_RULES: IgnoreRules = {
  extensions: ["crdownload", "part", "download", "tmp", "temp"],
  prefixes: ["~$"],
  exact_names: ["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"],
};

const DEV_IGNORE_RULES: IgnoreRules = {
  ...DEFAULT_IGNORE_RULES,
  exact_names: [
    ...DEFAULT_IGNORE_RULES.exact_names,
    ".git",
    "node_modules",
    "target",
    "dist",
    "__pycache__",
    ".idea",
    ".vscode",
  ],
};

const CREATIVE_OVERRIDES: ClassifyRule[] = [
  {
    extensions: ["psd", "ai", "sketch", "fig", "xd", "afdesign", "afphoto", "blend", "cdr"],
    category: "image",
  },
  { extensions: ["prproj", "aep"], category: "video" },
];

/** 可预选模板（默认 / 编程开发 / 素材创作）。 */
export const RULE_PRESETS: RulePreset[] = [
  {
    id: "default",
    nameKey: "settings.presetDefault",
    ignoreRules: DEFAULT_IGNORE_RULES,
    classifyOverrides: [],
  },
  {
    id: "dev",
    nameKey: "settings.presetDev",
    ignoreRules: DEV_IGNORE_RULES,
    classifyOverrides: [],
  },
  {
    id: "creative",
    nameKey: "settings.presetCreative",
    ignoreRules: DEFAULT_IGNORE_RULES,
    classifyOverrides: CREATIVE_OVERRIDES,
  },
];

/** 套用模板：仅替换规则类配置（浅克隆，避免共享引用被意外修改）。 */
export function applyPreset(settings: Settings, preset: RulePreset): Settings {
  return {
    ...settings,
    ignore_rules: {
      extensions: [...preset.ignoreRules.extensions],
      prefixes: [...preset.ignoreRules.prefixes],
      exact_names: [...preset.ignoreRules.exact_names],
    },
    classify_overrides: preset.classifyOverrides.map((rule) => ({
      extensions: [...rule.extensions],
      category: rule.category,
    })),
  };
}
