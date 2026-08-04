import { forwardRef, type TextareaHTMLAttributes } from "react";

export type TextAreaSize = "sm" | "md";

const SIZE_CLASSES: Record<TextAreaSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
};

/**
 * 统一多行文本域：样式令牌与 Input 完全一致，供长文本/详情输入复用。
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  {
    size?: TextAreaSize;
    invalid?: boolean;
    className?: string;
  } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">
>(function TextArea(
  { size = "md", invalid = false, className = "", ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={`min-w-0 w-full rounded-md border bg-slate-50 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:placeholder:text-slate-500 ${
        invalid
          ? "border-red-400 dark:border-red-500/50"
          : "border-slate-200"
      } ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    />
  );
});
