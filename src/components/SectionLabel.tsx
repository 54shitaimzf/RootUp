import type { HTMLAttributes, ReactNode } from "react";

/**
 * 统一区块标题：text-sm（弹窗内分组）/ text-xs（列表内小标题）两级，
 * 均 font-semibold + text-secondary，颜色随皮肤变量。
 */
export function SectionLabel({
  size = "sm",
  tone = "secondary",
  bar = false,
  className = "",
  children,
  ...rest
}: {
  size?: "sm" | "xs";
  tone?: "secondary" | "strong" | "brand";
  /** 左侧品牌色等高竖线（与分区标题同一层级规则） */
  bar?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const color =
    tone === "brand"
      ? "text-brand-700 dark:text-brand-300"
      : tone === "strong"
        ? "text-strong"
        : "text-secondary";
  return (
    <div
      className={`font-semibold ${color} ${size === "sm" ? "text-sm" : "text-xs"} ${
        bar ? "flex items-center gap-2" : ""
      } ${className}`}
      {...rest}
    >
      {bar && (
        <span
          aria-hidden="true"
          className="h-[1em] w-0.5 shrink-0 rounded-sm bg-brand-500"
        />
      )}
      {children}
    </div>
  );
}
