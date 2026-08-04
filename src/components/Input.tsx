import { forwardRef, type InputHTMLAttributes } from "react";

export type InputSize = "sm" | "md";

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
};

/** 统一文本输入框（样式与既有手写类等价，深浅主题/聚焦态由组件保证）。 */
export const Input = forwardRef<
  HTMLInputElement,
  {
    size?: InputSize;
    invalid?: boolean;
    className?: string;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "size">
>(function Input(
  { size = "md", invalid = false, className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`min-w-0 rounded-md border bg-slate-50 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500 ${
        invalid
          ? "border-red-400 dark:border-red-500/50"
          : "border-slate-200"
      } ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    />
  );
});
