import type { ReactNode } from "react";

/** 统一空态：标题 + 可选说明 + 可选动作（放在外层卡片/列表容器内）。 */
export function EmptyState({
  title,
  description,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-5 py-10 text-center text-sm text-muted ${className}`}>
      <p>{title}</p>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
