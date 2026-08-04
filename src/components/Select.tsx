import type { SelectHTMLAttributes } from "react";

/** 统一下拉选择框（样式与既有手写类等价）。 */
export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
