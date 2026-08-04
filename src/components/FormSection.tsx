import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";

/**
 * 表单分区：标题 + 可选描述 + 内容。
 *
 * 配合父容器 `divide-y divide-slate-100 dark:divide-slate-800` 使用，
 * 非首段自动出现分隔线；自身 `pt-4 first:pt-0` 统一段落间距。
 * 后续设置/编辑弹窗统一复用本组件。
 */
export function FormSection({
  title,
  description,
  className = "",
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`border-t border-slate-100 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3.5 w-0.5 shrink-0 rounded-sm bg-brand-500"
          aria-hidden="true"
        />
        <SectionLabel tone="strong">{title}</SectionLabel>
      </div>
      {description && (
        <p className="mt-0.5 pl-[10px] text-xs text-muted">{description}</p>
      )}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
