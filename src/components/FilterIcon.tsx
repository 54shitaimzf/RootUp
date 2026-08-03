import { Tag } from "lucide-react";
import { CATEGORY_ICON } from "./FileTypeIcon";

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
 * - all：ALL 徽章（圆环 + 字标，18px，保证可读性）；
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
    const Icon = CATEGORY_ICON[value ?? "other"] ?? CATEGORY_ICON.other;
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
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 18 18"
        className="size-[18px] shrink-0"
      >
        <circle
          cx="9"
          cy="9"
          r="7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <text
          x="9"
          y="11.6"
          textAnchor="middle"
          fontSize="7.5"
          fontWeight="800"
          letterSpacing="0.08em"
          fill="currentColor"
        >
          ALL
        </text>
      </svg>
    );
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
