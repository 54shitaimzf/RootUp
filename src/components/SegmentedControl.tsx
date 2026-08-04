import type { LucideIcon } from "lucide-react";

/**
 * 统一分段切换：用于页面视图切换与同层级的小选项切换。
 * tabs 变体支持图标、等宽（equal）与数量徽标（badge）。
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  badge?: number;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  variant = "segmented",
  equal = false,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  variant?: "segmented" | "tabs";
  equal?: boolean;
  className?: string;
}) {
  const sizeClass =
    size === "md" ? "px-3.5 py-1.5 text-sm" : "px-3 py-1 text-xs";
  const iconClass = size === "md" ? "size-4" : "size-3.5";
  const badgeClass = (active: boolean) =>
    `rounded-xs px-1.5 py-px text-[9px] font-semibold ${
      active
        ? "bg-brand-600 text-white dark:bg-brand-500"
        : "bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-100"
    }`;

  const renderContent = (option: SegmentedOption<T>, active: boolean) => {
    const Icon = option.icon;
    return (
      <>
        {Icon && <Icon aria-hidden className={iconClass} />}
        <span>{option.label}</span>
        {option.badge !== undefined && option.badge > 0 && (
          <span className={badgeClass(active)}>{option.badge}</span>
        )}
      </>
    );
  };

  if (variant === "tabs") {
    return (
      <div
        role="group"
        className={`flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 ${
          equal ? "w-full max-w-xs" : "inline-flex"
        } ${className}`}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`-mb-px flex items-center justify-center gap-1.5 border-b-2 font-medium transition-colors ${sizeClass} ${
                equal ? "flex-1" : ""
              } ${
                active
                  ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
                  : "border-transparent text-secondary hover:text-strong"
              }`}
            >
              {renderContent(option, active)}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      role="group"
      className={`inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex items-center gap-1.5 rounded-md font-medium transition-colors ${sizeClass} ${
              active
                ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {renderContent(option, active)}
          </button>
        );
      })}
    </div>
  );
}
