import { describe, expect, it } from "vitest";
import appContracts from "../../fixtures/app-contracts.json";
import defaultIgnoreRulesFixture from "../../fixtures/default-ignore-rules.json";
import { applyPreset, RULE_PRESETS } from "./presets";
import { DEFAULT_IGNORE_RULES, defaultSettings, type Settings } from "./tauri";

const VALID_CATEGORIES = appContracts.categories;

function sampleSettings(): Settings {
  return {
    ...defaultSettings,
    theme: "dark",
    language: "en",
    watched_dirs: ["C:/Downloads"],
  };
}

describe("RULE_PRESETS", () => {
  it("默认规则与共享 fixture 一致", () => {
    expect(DEFAULT_IGNORE_RULES).toEqual(defaultIgnoreRulesFixture);
    expect(defaultSettings.ignore_rules).toEqual(defaultIgnoreRulesFixture);
  });

  it("三套模板齐全", () => {
    expect(RULE_PRESETS.map((p) => p.id)).toEqual([
      "default",
      "dev",
      "creative",
    ]);
  });

  it("模板扩展名合法（无点、小写）", () => {
    for (const preset of RULE_PRESETS) {
      for (const ext of preset.ignoreRules.extensions) {
        expect(ext, `${preset.id} 扩展名 ${ext}`).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it("模板分类覆盖的类别合法", () => {
    for (const preset of RULE_PRESETS) {
      for (const rule of preset.classifyOverrides) {
        expect(VALID_CATEGORIES).toContain(rule.category);
        expect(rule.extensions.length).toBeGreaterThan(0);
      }
    }
  });

  it("编程模板忽略开发产物目录", () => {
    const dev = RULE_PRESETS.find((p) => p.id === "dev");
    expect(dev?.ignoreRules.exact_names).toContain("node_modules");
    expect(dev?.ignoreRules.exact_names).toContain(".git");
  });

  it("创作模板覆盖设计文件类别", () => {
    const creative = RULE_PRESETS.find((p) => p.id === "creative");
    const imageRule = creative?.classifyOverrides.find(
      (rule) => rule.category === "image",
    );
    expect(imageRule?.extensions).toContain("psd");
    expect(imageRule?.extensions).toContain("ai");
  });
});

describe("applyPreset", () => {
  it("只替换规则类配置，保留其他字段", () => {
    const settings = sampleSettings();
    const preset = RULE_PRESETS[1];
    const next = applyPreset(settings, preset);
    expect(next.theme).toBe("dark");
    expect(next.language).toBe("en");
    expect(next.watched_dirs).toEqual(["C:/Downloads"]);
    expect(next.version).toBe(settings.version);
    expect(next.ignore_rules).toEqual(preset.ignoreRules);
    expect(next.classify_overrides).toEqual(preset.classifyOverrides);
  });

  it("深克隆避免共享引用", () => {
    const settings = sampleSettings();
    const preset = RULE_PRESETS[1];
    const next = applyPreset(settings, preset);
    next.ignore_rules.extensions.push("custom");
    expect(preset.ignoreRules.extensions).not.toContain("custom");
  });

  it("原设置对象不被修改", () => {
    const settings = sampleSettings();
    applyPreset(settings, RULE_PRESETS[2]);
    expect(settings.ignore_rules.extensions).toEqual(
      defaultSettings.ignore_rules.extensions,
    );
    expect(settings.classify_overrides).toEqual([]);
  });
});
