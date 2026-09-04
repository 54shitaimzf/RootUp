import { resolveCategoryVisual } from "../lib/categoryDefs";

/**
 * 类别图标（纯渲染）：视觉取自 lib/categoryDefs 注册表（真源 fixtures/app-contracts.json）。
 * 本组件不再持有图标/颜色映射；新增类别 = fixture + 注册表各一项，组件零改动。
 */
export function FileTypeIcon({
  category,
  size = "md",
  title,
}: {
  category?: string | null;
  size?: "sm" | "md";
  title?: string;
}) {
  const visual = resolveCategoryVisual(category);
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
