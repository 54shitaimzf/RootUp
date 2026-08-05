import { forwardRef, type MouseEvent, type ReactNode, type Ref } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

export type ChipSize = "sm" | "md";
export type ChipVariant = "neutral" | "active" | "brand" | "selectable";

const SIZE_CLASSES: Record<ChipSize, string> = {
  sm: "h-6",
  md: "h-7",
};

const PAD_CLASSES: Record<ChipSize, string> = {
  sm: "pl-2 pr-1",
  md: "pl-2.5 pr-1.5",
};

const PAD_PLAIN: Record<ChipSize, string> = {
  sm: "px-2",
  md: "px-2.5",
};

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  neutral:
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  active: "bg-brand-700 text-white",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  selectable:
    "bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300",
};

const HOVER_NEUTRAL =
  "hover:bg-slate-200 dark:hover:bg-slate-700";

/**
 * 统一 chip：sm（h-6，文件页搜索标签）/ md（h-7，筛选与设置弹窗）；
 * 支持前置 icon、badge 角标、内嵌 ×（独立点击区，悬停红色反馈）；
 * 有 onClick 时渲染为 button 并附加中性 hover，否则渲染 span。
 */
export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  {
    size = "md",
    variant = "neutral",
    icon,
    badge,
    onRemove,
    removeLabel,
    onClick,
    className = "",
    children,
  },
  ref,
) {
  const base = `micro-press inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs font-medium ${SIZE_CLASSES[size]} ${variant === "neutral" && onClick ? HOVER_NEUTRAL : ""} ${VARIANT_CLASSES[variant]} ${onRemove ? PAD_CLASSES[size] : PAD_PLAIN[size]} ${className}`;

  const content = (
    <>
      {icon}
      <span className="min-w-0">{children}</span>
      {badge}
      {onRemove && (
        <IconButton
          size="xs"
          tone="inherit"
          label={removeLabel ?? ""}
          icon={X}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(event);
          }}
          className="-mr-0.5 text-current opacity-70 hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:hover:bg-red-500/15"
        />
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        onClick={onClick}
        className={base}
      >
        {content}
      </button>
    );
  }
  return (
    <span ref={ref as Ref<HTMLSpanElement>} className={base}>
      {content}
    </span>
  );
});

export interface ChipProps {
  size?: ChipSize;
  variant?: ChipVariant;
  icon?: ReactNode;
  badge?: ReactNode;
  onRemove?: (event: MouseEvent<HTMLButtonElement>) => void;
  removeLabel?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}
