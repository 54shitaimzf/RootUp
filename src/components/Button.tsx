import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "amber"
  | "ghost";
export type ButtonSize = "xs" | "sm" | "md";

/**
 * 变体与现有手写 class 的等价映射（默认皮肤）：
 * - primary   = bg-brand-700 hover:bg-brand-800 text-white font-medium
 * - secondary = bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium
 *               dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700
 * - danger    = border-red-300 text-red-600 hover:bg-red-50
 *               dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10
 * - amber     = bg-amber-500 hover:bg-amber-600 text-white font-medium
 * - ghost     = text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800
 * 尺寸：xs = px-2.5 py-1 text-xs；sm = px-3 py-1.5 text-xs；md = px-4 py-2 text-sm。
 * 皮肤：替换 tokens.css 品牌色即整体换肤，组件零改动。
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-brand-700 font-medium text-white transition-colors hover:bg-brand-800",
  secondary:
    "bg-slate-100 font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
  danger:
    "border font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10",
  amber: "bg-amber-500 font-medium text-white transition-colors hover:bg-amber-600",
  ghost:
    "text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "rounded-md px-2.5 py-1 text-xs",
  sm: "rounded-md px-3 py-1.5 text-xs",
  md: "rounded-md px-4 py-2 text-sm",
};

const ICON_CLASSES: Record<ButtonSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
};

export function Button({
  variant = "secondary",
  size = "sm",
  icon: Icon,
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon className={ICON_CLASSES[size]} />}
      {children}
    </button>
  );
}
