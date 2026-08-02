import { describe, expect, it } from "vitest";
import {
  buildEffectiveMap,
  resetExtensionCategory,
  resolveCurrentScheme,
  setExtensionCategory,
  summarizeIgnoreRules,
} from "./effectiveMap";
import { RULE_PRESETS } from "./presets";
import { defaultSettings, type ClassifyDefaultEntry, type ClassifyRule, type Settings } from "./tauri";

const DEFAULTS: ClassifyDefaultEntry[] = [
  { extension: "pdf", category: "document" },
  { extension: "png", category: "image" },
  { extension: "zip", category: "archive" },
];

function settingsWith(
  ignore: Partial<Settings["ignore_rules"]>,
  overrides: ClassifyRule[],
): Settings {
  return {
    ...defaultSettings,
    ignore_rules: { ...defaultSettings.ignore_rules, ...ignore },
    classify_overrides: overrides,
  };
}

describe("buildEffectiveMap", () => {
  it("无覆盖时返回纯内置映射", () => {
    const { map, overridden } = buildEffectiveMap(DEFAULTS, []);
    expect(map["pdf"]).toBe("document");
    expect(map["png"]).toBe("image");
    expect(overridden.size).toBe(0);
  });

  it("覆盖优先于内置映射", () => {
    const { map, overridden } = buildEffectiveMap(DEFAULTS, [
      { extensions: ["pdf"], category: "data" },
    ]);
    expect(map["pdf"]).toBe("data");
    expect(overridden.has("pdf")).toBe(true);
  });

  it("覆盖可新增内置映射之外的扩展名", () => {
    const { map, overridden } = buildEffectiveMap(DEFAULTS, [
      { extensions: ["psd"], category: "image" },
    ]);
    expect(map["psd"]).toBe("image");
    expect(overridden.has("psd")).toBe(true);
  });

  it("扩展名大小写不敏感且覆盖集合去重", () => {
    const { map, overridden } = buildEffectiveMap(DEFAULTS, [
      { extensions: ["PDF", "Pdf"], category: "data" },
    ]);
    expect(map["pdf"]).toBe("data");
    expect(overridden.size).toBe(1);
  });
});

describe("setExtensionCategory", () => {
  it("新增扩展名映射时创建独立规则", () => {
    const next = setExtensionCategory([], "psd", "image");
    expect(next).toEqual([{ extensions: ["psd"], category: "image" }]);
  });

  it("改类别时从多扩展名规则中拆出该扩展名", () => {
    const overrides: ClassifyRule[] = [
      { extensions: ["psd", "ai"], category: "image" },
    ];
    const next = setExtensionCategory(overrides, "psd", "video");
    expect(next).toEqual([
      { extensions: ["ai"], category: "image" },
      { extensions: ["psd"], category: "video" },
    ]);
  });

  it("改到已有目标类别规则时合并而非新建", () => {
    const overrides: ClassifyRule[] = [
      { extensions: ["psd"], category: "image" },
      { extensions: ["mov"], category: "video" },
    ];
    const next = setExtensionCategory(overrides, "psd", "video");
    expect(next).toEqual([{ extensions: ["mov", "psd"], category: "video" }]);
  });

  it("同类别修改为无操作", () => {
    const overrides: ClassifyRule[] = [{ extensions: ["psd"], category: "image" }];
    expect(setExtensionCategory(overrides, "psd", "image")).toEqual(overrides);
  });

  it("覆盖非内置扩展名到原类别时保留规则", () => {
    const overrides: ClassifyRule[] = [{ extensions: ["psd"], category: "image" }];
    expect(setExtensionCategory(overrides, "psd", "image")).toEqual(overrides);
  });
});

describe("resetExtensionCategory", () => {
  it("从分组规则中移除单个扩展名并保留其余", () => {
    const overrides: ClassifyRule[] = [
      { extensions: ["psd", "ai"], category: "image" },
    ];
    expect(resetExtensionCategory(overrides, "psd")).toEqual([
      { extensions: ["ai"], category: "image" },
    ]);
  });

  it("唯一扩展名被移除时删除整条规则", () => {
    const overrides: ClassifyRule[] = [{ extensions: ["psd"], category: "image" }];
    expect(resetExtensionCategory(overrides, "psd")).toEqual([]);
  });

  it("不存在的扩展名无影响", () => {
    const overrides: ClassifyRule[] = [{ extensions: ["psd"], category: "image" }];
    expect(resetExtensionCategory(overrides, "mov")).toEqual(overrides);
  });
});

describe("summarizeIgnoreRules", () => {
  it("统计三组数量与总数", () => {
    const summary = summarizeIgnoreRules({
      extensions: ["tmp", "crdownload"],
      prefixes: ["~$"],
      exact_names: ["desktop.ini"],
    });
    expect(summary).toEqual({ total: 4, extensions: 2, prefixes: 1, exactNames: 1 });
  });

  it("空规则计数为零", () => {
    const summary = summarizeIgnoreRules({ extensions: [], prefixes: [], exact_names: [] });
    expect(summary.total).toBe(0);
  });
});

describe("resolveCurrentScheme", () => {
  it("规则与内置模板不一致时为 unsaved", () => {
    const settings = settingsWith(
      { extensions: ["tmp"] },
      [{ extensions: ["psd"], category: "image" }],
    );
    const current = resolveCurrentScheme(settings, RULE_PRESETS, []);
    expect(current).toEqual({ kind: "unsaved" });
  });

  it("与内置模板完全一致时识别为内置", () => {
    const preset = RULE_PRESETS[0];
    const settings = settingsWith(
      {
        extensions: preset.ignoreRules.extensions,
        prefixes: preset.ignoreRules.prefixes,
        exact_names: preset.ignoreRules.exact_names,
      },
      preset.classifyOverrides,
    );
    expect(resolveCurrentScheme(settings, RULE_PRESETS, [])).toEqual({
      kind: "builtin",
      nameKey: preset.nameKey,
    });
  });

  it("与自定义方案一致时识别为 custom", () => {
    const schemes = [
      {
        name: "我的方案",
        ignore_rules: { extensions: ["zzz"], prefixes: [], exact_names: [] },
        classify_overrides: [{ extensions: ["psd"], category: "image" }],
      },
    ];
    const settings = settingsWith(
      { extensions: ["zzz"], prefixes: [], exact_names: [] },
      [{ extensions: ["psd"], category: "image" }],
    );
    expect(resolveCurrentScheme(settings, RULE_PRESETS, schemes)).toEqual({
      kind: "custom",
      name: "我的方案",
    });
  });

  it("两者都不命中时为 unsaved", () => {
    const settings = settingsWith(
      { extensions: ["custom1"], prefixes: [], exact_names: [] },
      [],
    );
    expect(resolveCurrentScheme(settings, RULE_PRESETS, [])).toEqual({ kind: "unsaved" });
  });

  it("内置优先级高于同名规则的自定义方案", () => {
    const preset = RULE_PRESETS[0];
    const schemes = [
      {
        name: "重复内置",
        ignore_rules: {
          extensions: preset.ignoreRules.extensions,
          prefixes: preset.ignoreRules.prefixes,
          exact_names: preset.ignoreRules.exact_names,
        },
        classify_overrides: preset.classifyOverrides,
      },
    ];
    const settings = settingsWith(
      {
        extensions: preset.ignoreRules.extensions,
        prefixes: preset.ignoreRules.prefixes,
        exact_names: preset.ignoreRules.exact_names,
      },
      preset.classifyOverrides,
    );
    expect(resolveCurrentScheme(settings, RULE_PRESETS, schemes).kind).toBe("builtin");
  });
});
