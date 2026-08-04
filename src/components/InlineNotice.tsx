import type { ReactNode } from "react";

/** 行内提示条：success / error / info（替换弹窗内手写红/绿块）。 */
export function InlineNotice({
  variant = "info",
  className = "",
  children,
}: {
  variant?: "info" | "success" | "error";
  className?: string;
  children: ReactNode;
}) {
  const classes: Record<string, string> = {
    info: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    success: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
    error: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  };
  return (
    <p className={`rounded-md px-3 py-2 text-xs ${classes[variant]} ${className}`}>
      {children}
    </p>
  );
}
