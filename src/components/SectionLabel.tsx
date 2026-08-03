import type { HTMLAttributes, ReactNode } from "react";

/**
 * 统一区块标题：text-sm（弹窗内分组）/ text-xs（列表内小标题）两级，
 * 均 font-semibold + text-secondary，颜色随皮肤变量。
 */
export function SectionLabel({
  size = "sm",
  className = "",
  children,
  ...rest
}: {
  size?: "sm" | "xs";
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`font-semibold text-secondary ${size === "sm" ? "text-sm" : "text-xs"} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
