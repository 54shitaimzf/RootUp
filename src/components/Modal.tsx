import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./IconButton";

/**
 * 共享弹窗壳：遮罩点击 / Esc 关闭、滚动内容区、吸底按钮区。
 * 视觉令牌与 CloseConfirmDialog 保持一致。
 */
export function Modal({
  open,
  title,
  onClose,
  width = "max-w-xl",
  contentHeight,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  width?: string;
  contentHeight?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`floating-panel flex max-h-[85vh] w-full ${width} flex-col`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-strong">{title}</h2>
          <IconButton
            label={t("settings.dialogClose")}
            icon={X}
            tone="neutral"
            size="md"
            onClick={onClose}
          />
        </div>
        <div
          className={`min-h-0 overflow-y-auto px-5 py-4 ${
            contentHeight ? `flex-none ${contentHeight}` : "flex-1"
          }`}
        >
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
