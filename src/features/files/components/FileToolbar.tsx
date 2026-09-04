import { useTranslation } from "react-i18next";
import { Archive, CheckSquare } from "../../../theme/icons";
import { Button } from "../../../components/Button";

export interface FileToolbarProps {
  archiveRootConfigured: boolean;
  unarchivedCount: number;
  batchMode: boolean;
  filterActive: boolean;
  selectedCount: number;
  /** 筛选结果待归档数量（total 已被后端钳制在上限内）。 */
  filteredCount: number;
  archiveBatchLimit: number;
  onEnterBatchMode: () => void;
  onArchiveSelected: () => void;
  onArchiveFiltered: () => void;
  onCancelSelection: () => void;
}

/** 批量模式工具条（进入批量 / 归档所选 / 归档当前筛选 / 取消选择）。 */
export function FileToolbar({
  archiveRootConfigured,
  unarchivedCount,
  batchMode,
  filterActive,
  selectedCount,
  filteredCount,
  archiveBatchLimit,
  onEnterBatchMode,
  onArchiveSelected,
  onArchiveFiltered,
  onCancelSelection,
}: FileToolbarProps) {
  const { t } = useTranslation();
  if (!archiveRootConfigured || (unarchivedCount <= 0 && !batchMode)) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {!batchMode && (
        <Button
          variant="secondary"
          size="sm"
          icon={CheckSquare}
          onClick={onEnterBatchMode}
        >
          {t("files.batchMode")}
        </Button>
      )}
      {filterActive && (
        <Button
          variant="danger"
          size="sm"
          icon={Archive}
          onClick={onArchiveFiltered}
        >
          {t("files.archiveFiltered", {
            count: filteredCount > archiveBatchLimit ? `${archiveBatchLimit}+` : filteredCount,
          })}
        </Button>
      )}
      {batchMode && (
        <>
          <span className="text-xs text-muted">
            {t("files.batchSelected", { count: selectedCount })}
          </span>
          <Button
            variant="danger"
            size="sm"
            icon={Archive}
            disabled={selectedCount === 0}
            onClick={onArchiveSelected}
          >
            {t("files.archiveSelected")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancelSelection}>
            {t("files.cancelSelection")}
          </Button>
        </>
      )}
    </div>
  );
}
