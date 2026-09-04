import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "../theme/icons";
import { Tooltip } from "./Tooltip";

export type IconButtonSize = "xs" | "sm" | "md";
export type IconButtonTone = "neutral" | "danger" | "brand" | "inherit";

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: "size-5 rounded-md [&_svg]:size-3",
  sm: "size-6 rounded-md [&_svg]:size-3.5",
  md: "size-7 rounded-md [&_svg]:size-4",
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  neutral:
    "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300",
  danger:
    "text-slate-400 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-500/15 dark:hover:text-red-400",
  brand:
    "text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-500 dark:hover:bg-brand-500/10 dark:hover:text-brand-300",
  inherit: "",
};

/**
 * 统一的图标按钮：常显中灰，hover 有淡背景 + 深色/红色反馈；
 * label 同时作为 title 与 aria-label；className 透传可覆盖颜色。
 * tone="inherit" 时不写默认文字色，由调用方（如 chip 内 ×）通过 className 控制。
 */
export function IconButton({
  label,
  icon: Icon,
  tone = "neutral",
  size = "md",
  className = "",
  ...rest
}: {
  label: string;
  icon: LucideIcon;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        title={label}
        aria-label={label}
        className={`micro-press inline-flex shrink-0 items-center justify-center ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
        {...rest}
      >
        <Icon />
      </button>
    </Tooltip>
  );
}
