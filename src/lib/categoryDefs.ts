import type { LucideIcon } from "../theme/icons";
import {
  Archive,
  Code2,
  Database,
  File,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Package,
} from "../theme/icons";

/**
 * 类别视觉注册表（图标 + 圆底配色成对，深浅主题适配）。
 *
 * key 空间真源为 `fixtures/app-contracts.json` 的 categories（与 Rust
 * `Category::ALL` 同源断言）；未知 key 统一回退 other。筛选图标、文件行
 * 图标与归档预览目录解析共用本表，禁止平行硬编码。配色为 token class
 * 形态，皮肤可整体覆盖（v1.1/v1.3）。
 */
export interface CategoryVisual {
  icon: LucideIcon;
  /** 圆底配色 class（背景 + 前景，含 dark 变体）。 */
  boxClass: string;
}

export const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  document: {
    icon: FileText,
    boxClass: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  },
  image: {
    icon: ImageIcon,
    boxClass:
      "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  },
  video: {
    icon: Film,
    boxClass: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  },
  audio: {
    icon: Music,
    boxClass:
      "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  },
  archive: {
    icon: Archive,
    boxClass:
      "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
  },
  code: {
    icon: Code2,
    boxClass:
      "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  installer: {
    icon: Package,
    boxClass: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  },
  data: {
    icon: Database,
    boxClass: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
  },
  other: {
    icon: File,
    boxClass: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  },
};

export const DEFAULT_CATEGORY = "other";

/** 解析类别 key：未知/空值回退 other（归档目录名等存储语义用）。 */
export function resolveCategoryKey(category?: string | null): string {
  return category && category in CATEGORY_VISUALS ? category : DEFAULT_CATEGORY;
}

/** 解析类别视觉：未知/空值回退 other。 */
export function resolveCategoryVisual(
  category?: string | null,
): CategoryVisual {
  return CATEGORY_VISUALS[resolveCategoryKey(category)];
}
