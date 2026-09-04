import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import type { FileRecord } from "../../../lib/tauri";
import { archivePreview } from "../model";
import type { ArchiveTarget } from "../hooks/useFileArchive";

export type { ArchiveTarget };

export interface ArchiveConfirmDialogProps {
  target: ArchiveTarget | null;
  archiveRoot: string;
  items: FileRecord[];
  selected: Set<string>;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 归档确认弹层：所选模式带前 3 条目标路径预览，筛选模式仅提示数量与根目录。 */
export function ArchiveConfirmDialog({
  target,
  archiveRoot,
  items,
  selected,
  onConfirm,
  onCancel,
}: ArchiveConfirmDialogProps) {
  const { t } = useTranslation();
  const description = target
    ? target.mode === "selected"
      ? t("files.archiveConfirmSelectedDesc", {
          count: target.count,
          root: archiveRoot,
          preview: items
            .filter((file) => selected.has(file.path))
            .slice(0, 3)
            .map((file) => archivePreview(file.path, file.labels, archiveRoot))
            .join("\n"),
        })
      : t("files.archiveConfirmFilteredDesc", {
          count: target.count,
          root: archiveRoot,
        })
    : "";
  return (
    <ConfirmDialog
      open={target !== null}
      title={t("files.archiveConfirmTitle")}
      description={description}
      confirmLabel={t("files.archiveConfirm", {
        count: target?.count ?? 0,
      })}
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
