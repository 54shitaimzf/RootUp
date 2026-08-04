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
    <section className={`pt-4 first:pt-0 ${className}`}>
      <SectionLabel>{title}</SectionLabel>
      {description && (
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      )}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
