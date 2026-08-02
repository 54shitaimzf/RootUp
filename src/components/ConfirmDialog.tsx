import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Modal } from "./Modal";

/** 确认弹窗：破坏性/覆盖性操作的统一确认入口，样式与其它弹窗一致。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width="max-w-sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onCancel}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="md"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </Modal>
  );
}
