import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "../../../theme/icons";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { RevealLink } from "../../../components/RevealLink";
import { Tooltip } from "../../../components/Tooltip";
import type { FileRecord } from "../../../lib/tauri";
import { archiveDestPath } from "../../../lib/fileUtils";
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

/** 摘要视图预览的文件名数量，超出部分进入完整列表视图。 */
const PREVIEW_COUNT = 3;

/**
 * 归档确认弹层：目的地只显示「档案库」友好名（悬浮=完整路径，点击=资源管理器定位）；
 * 所选模式列前 3 个文件名（悬浮=单文件完整目标路径），更多时切换到完整列表视图。
 */
export function ArchiveConfirmDialog({
  target,
  archiveRoot,
  items,
  selected,
  onConfirm,
  onCancel,
}: ArchiveConfirmDialogProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setShowAll(false);
  }, [target]);
  const selectedFiles = items.filter((file) => selected.has(file.path));
  const unknownCount = (target?.count ?? 0) <= 0;
  const description = target
    ? target.mode === "selected"
      ? t("files.archiveConfirmSelectedDesc", { count: target.count })
      : unknownCount
        ? t("files.archiveConfirmFilteredDescNoCount")
        : t("files.archiveConfirmFilteredDesc", { count: target.count })
    : "";
  // 确认前的前端预览（镜像规则受 fixtures/archive-dest-cases.json 契约锁定）；
  // 确认后的真实目标以后端 ArchiveOutcome.results 为准（含冲突改名），不得用本函数替代。
  const fileRow = (file: FileRecord) => (
    <Tooltip
      key={file.path}
      content={archiveDestPath(archiveRoot, file.labels, file.name)}
      className="block"
    >
      <span className="block cursor-default truncate rounded-md bg-slate-50 px-2.5 py-1 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {file.name}
      </span>
    </Tooltip>
  );
  return (
    <ConfirmDialog
      open={target !== null}
      title={
        showAll
          ? t("files.archiveListTitle", { count: target?.count ?? 0 })
          : t("files.archiveConfirmTitle")
      }
      description={description}
      width={showAll ? "max-w-md" : "max-w-sm"}
      confirmLabel={
        unknownCount
          ? t("files.archiveConfirmNoCount")
          : t("files.archiveConfirm", {
              count: target?.count ?? 0,
            })
      }
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="mt-2">
        <RevealLink label={t("files.archiveDestLabel")} path={archiveRoot} />
      </div>
      {target?.mode === "selected" && !showAll && (
        <>
          <div className="mt-3 text-xs font-medium text-strong">
            {t("files.archivePreviewLabel")}
          </div>
          <div className="mt-1 space-y-1">
            {selectedFiles.slice(0, PREVIEW_COUNT).map(fileRow)}
          </div>
          {selectedFiles.length > PREVIEW_COUNT && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setShowAll(true)}
            >
              {t("files.archiveShowAll", { count: selectedFiles.length })}
            </Button>
          )}
        </>
      )}
      {target?.mode === "selected" && showAll && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mt-2"
            onClick={() => setShowAll(false)}
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            {t("files.back")}
          </Button>
          <div className="mt-1 space-y-1">
            {selectedFiles.map(fileRow)}
          </div>
        </>
      )}
    </ConfirmDialog>
  );
}
