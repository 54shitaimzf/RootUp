/**
 * 统一分段切换：用于页面视图切换与同层级的小选项切换。
 * 选中项使用浅底 + 投影，未选中项为中性文字，深浅主题自适应。
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  const sizeClass = size === "md" ? "px-3.5 py-1.5 text-sm" : "px-3 py-1 text-xs";
  return (
    <div
      role="group"
      className={`inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-md font-medium transition-colors ${sizeClass} ${
              active
                ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
