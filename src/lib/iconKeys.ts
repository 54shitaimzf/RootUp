import type { LucideIcon } from "../theme/icons";
import { Folder, Package } from "../theme/icons";
import registry from "../../fixtures/icon-keys.json";

/**
 * 数据图标 key 注册表（0.8.8 下半）。真源为 `fixtures/icon-keys.json`：
 * - labels：标签图标 key（与 lib/labelDefs 的 LABEL_ICONS 同源断言）；
 * - units：单元类型 key（file / project / software，与 Rust UnitKind 一致）；
 * - softwareKinds：软件识别依据 key（与 Rust core/software.rs DETECTED_* 同源断言）。
 * 未知 key 统一经 resolveIconKey 回退，禁止平行硬编码。
 */
export const ICON_KEY_REGISTRY = {
  labels: registry.labels as readonly string[],
  units: registry.units as readonly string[],
  softwareKinds: registry.softwareKinds as readonly string[],
} as const;

/** 单元类型 key（与 lib/tauri 的 FileRecord.kind 对应）。 */
export type UnitIconKey = "file" | "project" | "software";

/** 单元类型视觉（行首图标；file 不在此注册——文件沿用类别图标，零回归）。 */
export const UNIT_VISUALS: Partial<Record<UnitIconKey, { icon: LucideIcon; boxClass: string }>> = {
  project: {
    icon: Folder,
    boxClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  software: {
    icon: Package,
    boxClass: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400",
  },
};

/**
 * 图标 key 解析：合法值原样返回，未知/空值回退 fallback。
 * 标签图标经 labelDefs.labelIconKey 走同一语义；本函数供单元/识别依据等新键空间复用。
 */
export function resolveIconKey(key: string | null | undefined, keys: readonly string[], fallback: string): string {
  return key && keys.includes(key) ? key : fallback;
}

/** 软件识别依据 key 解析：未知回退 heuristic（最弱口径展示）。 */
export function softwareKindKey(key?: string | null): string {
  return resolveIconKey(key, ICON_KEY_REGISTRY.softwareKinds, "heuristic");
}
