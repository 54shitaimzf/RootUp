import type { ClassifyDefaultEntry, ClassifyRule, IgnoreRules, Settings } from "./tauri";
import type { RulePreset } from "./presets";

/** 合并后的生效映射：扩展名 -> 类别，以及被自定义覆盖的扩展名集合。 */
export interface EffectiveMap {
  map: Record<string, string>;
  overridden: Set<string>;
}

/** 当前设置命中的方案类型。 */
export type CurrentScheme =
  | { kind: "builtin"; nameKey: string }
  | { kind: "custom"; name: string }
  | { kind: "unsaved" };

/** 内置映射 + 用户覆盖 = 生效映射；覆盖优先，扩展名小写归一。 */
export function buildEffectiveMap(
  defaults: ClassifyDefaultEntry[],
  overrides: ClassifyRule[],
): EffectiveMap {
  const map: Record<string, string> = {};
  const overridden = new Set<string>();
  for (const entry of defaults) {
    map[entry.extension.toLowerCase()] = entry.category;
  }
  for (const rule of overrides) {
    for (const ext of rule.extensions) {
      const key = ext.toLowerCase();
      map[key] = rule.category;
      overridden.add(key);
    }
  }
  return { map, overridden };
}

/**
 * 把单个扩展名的类别改为 target。
 *
 * 存储粒度是分组规则，但编辑粒度是单个扩展名：
 * 从旧规则中拆出该扩展名，再并入目标类别已有规则（或新建规则），空规则自动删除。
 */
export function setExtensionCategory(
  overrides: ClassifyRule[],
  ext: string,
  category: string,
): ClassifyRule[] {
  const key = ext.trim().toLowerCase();
  const result: ClassifyRule[] = [];
  let covered = false;
  for (const rule of overrides) {
    const contains = rule.extensions.some((e) => e.toLowerCase() === key);
    if (contains && rule.category === category) {
      result.push(rule);
      covered = true;
      continue;
    }
    if (contains) {
      const remaining = rule.extensions.filter((e) => e.toLowerCase() !== key);
      if (remaining.length > 0) {
        result.push({ ...rule, extensions: remaining });
      }
      continue;
    }
    result.push(rule);
  }
  if (!covered) {
    const target = result.find((rule) => rule.category === category);
    if (target) {
      target.extensions = [...target.extensions, key];
    } else {
      result.push({ extensions: [key], category });
    }
  }
  return result;
}

/** 移除某扩展名的自定义覆盖，恢复为内置映射；空规则自动删除。 */
export function resetExtensionCategory(
  overrides: ClassifyRule[],
  ext: string,
): ClassifyRule[] {
  const key = ext.trim().toLowerCase();
  return overrides
    .map((rule) => ({
      ...rule,
      extensions: rule.extensions.filter((e) => e.toLowerCase() !== key),
    }))
    .filter((rule) => rule.extensions.length > 0);
}

/** 忽略规则摘要计数。 */
export function summarizeIgnoreRules(rules: IgnoreRules) {
  return {
    total: rules.extensions.length + rules.prefixes.length + rules.exact_names.length,
    extensions: rules.extensions.length,
    prefixes: rules.prefixes.length,
    exactNames: rules.exact_names.length,
  };
}

function sameRules(
  a: { ignore_rules: IgnoreRules; classify_overrides: ClassifyRule[] },
  b: { ignore_rules: IgnoreRules; classify_overrides: ClassifyRule[] },
): boolean {
  return (
    JSON.stringify(a.ignore_rules) === JSON.stringify(b.ignore_rules) &&
    JSON.stringify(a.classify_overrides) === JSON.stringify(b.classify_overrides)
  );
}

/**
 * 判断当前设置命中哪个方案。
 *
 * 优先级：内置模板 > 自定义方案；都不命中时视为“自定义（未保存）”。
 */
export function resolveCurrentScheme(
  settings: Settings,
  presets: RulePreset[],
  schemes: { name: string; ignore_rules: IgnoreRules; classify_overrides: ClassifyRule[] }[],
): CurrentScheme {
  for (const preset of presets) {
    if (
      sameRules(settings, {
        ignore_rules: preset.ignoreRules,
        classify_overrides: preset.classifyOverrides,
      })
    ) {
      return { kind: "builtin", nameKey: preset.nameKey };
    }
  }
  for (const scheme of schemes) {
    if (sameRules(settings, scheme)) {
      return { kind: "custom", name: scheme.name };
    }
  }
  return { kind: "unsaved" };
}
