import type { ReactNode } from "react";

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
  indentContent = false,
  className = "",
  children,
}: {
  title: string;
  description?: string;
  /** 内容区整体缩进 + 左侧引导线（设置页分区层级用，弹窗保持默认） */
  indentContent?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${indentContent ? "pb-9" : "pb-[30px]"} ${className}`}>
      <div
        aria-hidden="true"
        className={`form-section-divider mx-auto h-px w-[calc(100%-3rem)] bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-slate-700/70 ${
          indentContent ? "mb-9" : "mb-[30px]"
        }`}
      />
      <h3 className="flex items-center gap-2 text-base font-semibold text-brand-700 dark:text-brand-300">
        <span
          className="h-[1em] w-0.5 shrink-0 rounded-sm bg-brand-500"
          aria-hidden="true"
        />
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 pl-[10px] text-xs text-muted">{description}</p>
      )}
      <div
        className={
          indentContent
            ? "mt-4 border-l border-dashed border-slate-200 pl-4 dark:border-slate-700/60"
            : "mt-3"
        }
      >
        {children}
      </div>
    </section>
  );
}
