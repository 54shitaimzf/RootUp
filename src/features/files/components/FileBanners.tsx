import { useTranslation } from "react-i18next";
import { Banner } from "../../../components/Banner";
import { Button } from "../../../components/Button";
import { Tooltip } from "../../../components/Tooltip";
import { pathBasename, splitPathError } from "../../../lib/fileUtils";
import type { ScanController } from "../../../hooks/useScan";
import type { ArchiveFailureSummary } from "../hooks/useFileArchive";

export interface FileBannersProps {
  scan: ScanController;
  /** 有实时变更但当前处于筛选/翻页态，提示手动刷新。 */
  stale: boolean;
  onRefresh: () => void;
  actionError: string | null;
  autoArchiveHintVisible: boolean;
  onDismissAutoHint: () => void;
  archiveNotice: { batchId: number; count: number } | null;
  onUndoArchive: (batchId: number) => void;
  onDismissNotice: () => void;
  archiveError: string | null;
  onDismissError: () => void;
  archiveFailure: ArchiveFailureSummary | null;
  onDismissFailure: () => void;
}

/** 文件页横幅区：扫描中 / 扫描失败 / 新变更 / 操作错误 / 自动归档提示 / 归档成功与失败。 */
export function FileBanners({
  scan,
  stale,
  onRefresh,
  actionError,
  autoArchiveHintVisible,
  onDismissAutoHint,
  archiveNotice,
  onUndoArchive,
  onDismissNotice,
  archiveError,
  onDismissError,
  archiveFailure,
  onDismissFailure,
}: FileBannersProps) {
  const { t } = useTranslation();
  const scanning = scan.status?.active ?? false;
  const scanDir = scan.status?.dir ?? "";
  const scanProcessed = scan.status?.processed ?? 0;
  const scanDiscovered = scan.status?.discovered ?? 0;
  const failureDetail = archiveFailure ? splitPathError(archiveFailure.firstError) : null;
  return (
    <>
      {scanning && (
        <Banner variant="brand" className="mt-4">
          <div>
            <div className="truncate font-medium text-brand-800 dark:text-brand-300">
              {t("files.scanning", { dir: scanDir })}
            </div>
            <div className="text-xs text-brand-700/80 dark:text-brand-400/80">
              {t("files.scanProgress", {
                processed: scanProcessed,
                discovered: scanDiscovered,
              })}
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => scan.cancel()}>
            {t("files.cancelScan")}
          </Button>
        </Banner>
      )}

      {scan.lastError && (
        <Banner variant="error" className="mt-4" onClose={scan.clearError}>
          <span className="block truncate">{scan.lastError}</span>
        </Banner>
      )}

      {stale && (
        <Banner
          variant="warn"
          padding="sm"
          className="mt-4"
          actions={
            <Button variant="amber" size="sm" onClick={onRefresh}>
              {t("files.refresh")}
            </Button>
          }
        >
          <span className="min-w-0 flex-1">{t("files.newChanges")}</span>
        </Banner>
      )}

      {actionError && (
        <Banner variant="warn" className="mt-4">
          <span className="min-w-0 flex-1">{actionError}</span>
        </Banner>
      )}

      {autoArchiveHintVisible && (
        <Banner variant="info" className="mt-4" onClose={onDismissAutoHint}>
          {t("files.autoArchiveOn")}
        </Banner>
      )}
      {archiveNotice && (
        <Banner
          variant="brand"
          className="mt-4"
          onClose={onDismissNotice}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onUndoArchive(archiveNotice.batchId)}
            >
              {t("files.undoArchive")}
            </Button>
          }
        >
          {t("files.archivedNotice", { count: archiveNotice.count })}
        </Banner>
      )}
      {archiveError && (
        <Banner variant="error" className="mt-4" onClose={onDismissError}>
          <span className="block truncate">{archiveError}</span>
        </Banner>
      )}
      {archiveFailure && failureDetail && (
        <Banner
          variant={archiveFailure.archived > 0 ? "warn" : "error"}
          className="mt-4"
          onClose={onDismissFailure}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {archiveFailure.archived > 0
                ? t("files.archivePartialFail", { failed: archiveFailure.failed })
                : t("files.archiveAllFail", { failed: archiveFailure.failed })}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
              {failureDetail.path && (
                <Tooltip
                  content={failureDetail.path}
                  className="inline-block min-w-0 max-w-full"
                >
                  <span className="cursor-default truncate font-mono">
                    {pathBasename(failureDetail.path)}
                  </span>
                </Tooltip>
              )}
              <span className={failureDetail.path ? "shrink-0" : "min-w-0"}>
                {failureDetail.reason}
              </span>
            </div>
            {archiveFailure.failed > 1 && (
              <div className="mt-0.5 text-xs">
                {t("files.archiveFailMore", { count: archiveFailure.failed - 1 })}
              </div>
            )}
          </div>
        </Banner>
      )}
    </>
  );
}
