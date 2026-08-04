import type { ReactNode } from "react";

/** 统一表单字段：标签 + 可选提示 + 控件，文字层级全局一致。 */
export function Field({
  label,
  hint,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-xs font-medium text-secondary">
          {label}
        </label>
      ) : (
        <span className="text-xs font-medium text-secondary">{label}</span>
      )}
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}
