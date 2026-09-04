import { resolveCategoryVisual } from "../lib/categoryDefs";
import { Tag } from "../theme/icons";
import { AllBadgeIcon } from "./AllBadgeIcon";

export type FilterIconKind =
  | "category"
  | "state"
  | "label"
  | "all"
  | "allStates";

/**
 * 筛选图标统一入口（矢量、单一来源）：
 * - category：lucide 类别线性图标；
 * - state：语义色实心圆点（颜色走 tokens 变量，皮肤可覆盖）；
 * - label：Tag 图标；
 * - all：AllBadgeIcon（独立组件，细圆环 + 字标，小尺寸可读）；
 * - allStates：空心圆环（与实心状态点形成对比）。
 * 全部图标 currentColor / 语义变量驱动，供 FilterBar 与自动补全共用。
 */
export function FilterIcon({
  kind,
  value,
}: {
  kind: FilterIconKind;
  value?: string;
}) {
  if (kind === "category") {
    const Icon = resolveCategoryVisual(value).icon;
    return <Icon aria-hidden="true" className="size-3.5 shrink-0" />;
  }
  if (kind === "state") {
    const color =
      value === "pending" ? "var(--state-pending)" : "var(--state-indexed)";
    return (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }
  if (kind === "label") {
    return <Tag aria-hidden="true" className="size-3.5 shrink-0" />;
  }
  if (kind === "all") {
    return <AllBadgeIcon className="size-[18px] shrink-0" />;
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 shrink-0">
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
