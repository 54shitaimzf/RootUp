import type { ReactNode } from "react";

/**
 * 统一弹窗底部按钮容器（右对齐 + 间距）。
 * 顺序约定（Windows 是左否右）：主操作/确认/删除在左，取消在最右。
 */
export function DialogFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-end gap-2 ${className}`}>
      {children}
    </div>
  );
}
