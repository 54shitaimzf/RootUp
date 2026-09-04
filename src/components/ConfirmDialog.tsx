import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

/** 确认弹窗：破坏性/覆盖性操作的统一确认入口，样式与其它弹窗一致。 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  danger = false,
  width = "max-w-sm",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** 说明文字；与 children 可并用（文字在上，附加内容在下）。 */
  description?: string;
  /** 说明文字之外的结构化内容（如归档目的地链接与文件预览）。 */
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  width?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={width}
      footer={
        <>
          <Button
            variant={danger ? "danger" : "primary"}
            size="md"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" size="md" onClick={onCancel}>
            {t("settings.cancel")}
          </Button>
        </>
      }
    >
      {description && (
        <p className="break-words text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {children}
    </Modal>
  );
}
