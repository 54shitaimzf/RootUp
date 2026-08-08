import type { ReactNode } from "react";

/** 统一页面标题 + 描述（视觉与既有页面头部等价）。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** 可选右侧操作区：传入后才切换为“左标题右操作”布局，默认渲染路径不变 */
  actions?: ReactNode;
}) {
  if (actions) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-strong">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-1">{actions}</div>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold text-strong">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </>
  );
}
