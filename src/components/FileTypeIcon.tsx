import { resolveCategoryVisual } from "../lib/categoryDefs";
import { UNIT_VISUALS, type UnitIconKey } from "../lib/iconKeys";

/**
 * 类别图标（纯渲染）：视觉取自 lib/categoryDefs 注册表（真源 fixtures/app-contracts.json）。
 * 本组件不再持有图标/颜色映射；新增类别 = fixture + 注册表各一项，组件零改动。
 *
 * 0.8.8：project / software 单元行传 unitKind（视觉取 lib/iconKeys 的 UNIT_VISUALS，
 * 键空间真源 fixtures/icon-keys.json），优先于类别图标；文件行不传，保持零回归。
 */
export function FileTypeIcon({
  category,
  unitKind,
  size = "md",
  title,
}: {
  category?: string | null;
  unitKind?: UnitIconKey;
  size?: "sm" | "md";
  title?: string;
}) {
  const unitVisual = unitKind ? UNIT_VISUALS[unitKind] : undefined;
  const visual = unitVisual ?? resolveCategoryVisual(category);
  const Icon = visual.icon;
  const boxClass = size === "sm" ? "size-7 rounded-md" : "size-9 rounded-lg";
  const iconClass = size === "sm" ? "size-4" : "size-5";
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`flex ${boxClass} shrink-0 items-center justify-center ${visual.boxClass}`}
    >
      <Icon className={iconClass} />
    </span>
  );
}
