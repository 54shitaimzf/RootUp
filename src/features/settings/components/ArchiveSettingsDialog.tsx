import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Undo2, FolderOpen } from "../../../theme/icons";
import {
  listArchiveBatches,
  openDirectoryDialog,
  undoArchive,
  type ArchiveBatch,
} from "../../../lib/tauri";
import { formatTimestamp } from "../../../lib/fileUtils";
import { Button } from "../../../components/Button";
import { IconButton } from "../../../components/IconButton";
import { InlineNotice } from "../../../components/InlineNotice";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { SectionLabel } from "../../../components/SectionLabel";
import { Tooltip } from "../../../components/Tooltip";

/**
 * 归档设置弹窗：归档根目录、自动归档开关、最近归档（可撤销）。
 */
export function ArchiveSettingsDialog({
  open,
  root,
  autoArchive,
  onSave,
  onClose,
}: {
  open: boolean;
  root: string;
  autoArchive: boolean;
  onSave: (draft: { archive_root: string; auto_archive: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rootInput, setRootInput] = useState(root);
  const [auto, setAuto] = useState(autoArchive);
  const [batches, setBatches] = useState<ArchiveBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRootInput(root);
    setAuto(autoArchive);
    setError(null);
    listArchiveBatches(50)
      .then(setBatches)
      .catch(() => setBatches([]));
  }, [open, root, autoArchive]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ archive_root: rootInput.trim(), auto_archive: auto });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async (batchId: number) => {
    try {
      await undoArchive(batchId);
      setError(null);
      const next = await listArchiveBatches(50);
      setBatches(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const browse = async () => {
    try {
      const dir = await openDirectoryDialog();
      if (dir) setRootInput(dir);
    } catch {
      // 选择器不可用或用户取消：保留手输路径
    }
  };

  return (
    <Modal
      open={open}
      title={t("settings.archiveDialogTitle")}
      onClose={onClose}
      width="max-w-lg"
      brandTitle
      footer={
        <>
          <Button variant="primary" size="md" disabled={saving} onClick={() => void save()}>
            {t("settings.save")}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <InlineNotice variant="error">{error}</InlineNotice>}
        <InlineNotice variant="info">{t("settings.archiveRootHint")}</InlineNotice>

        <div>
          <SectionLabel>{t("settings.archiveRootLabel")}</SectionLabel>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              type="text"
              value={rootInput}
              onChange={(event) => setRootInput(event.target.value)}
              placeholder={t("settings.archiveRootPlaceholder")}
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              variant="secondary"
              size="md"
              icon={FolderOpen}
              className="shrink-0"
              onClick={() => void browse()}
            >
              {t("settings.browse")}
            </Button>
          </div>
        </div>

        <div>
          <SectionLabel>{t("settings.autoArchiveLabel")}</SectionLabel>
          <p className="mt-1 text-xs text-muted">{t("settings.autoArchiveHint")}</p>
          <Button
            variant={auto ? "primary" : "secondary"}
            size="sm"
            className="mt-2"
            onClick={() => setAuto((value) => !value)}
          >
            {auto
              ? t("settings.autoArchiveOffButton")
              : t("settings.autoArchiveOnButton")}
          </Button>
        </div>

        <div>
          <SectionLabel>{t("settings.recentArchive")}</SectionLabel>
          {batches.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{t("settings.recentArchiveEmpty")}</p>
          ) : (
            <div className="mt-2 space-y-1">
              {batches.map((batch) => (
                <div
                  key={batch.batchId}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800"
                >
                  <span className="min-w-0 flex-1 truncate text-secondary">
                    {formatTimestamp(batch.createdAt)} · {batch.count}{" "}
                    {t(
                      batch.kind === "project"
                        ? "settings.archiveKindProject"
                        : "settings.archiveKindFile",
                    )}
                  </span>
                  <Tooltip content={batch.sampleDest} className="inline-block">
                    <span className="hidden max-w-40 cursor-default truncate font-mono text-[10px] text-muted sm:block">
                      {batch.sampleDest.split("/").pop() || batch.sampleDest}
                    </span>
                  </Tooltip>
                  {batch.undone ? (
                    <span className="shrink-0 text-muted">{t("settings.archiveUndone")}</span>
                  ) : (
                    <IconButton
                      label={t("files.undoArchive")}
                      icon={Undo2}
                      tone="brand"
                      size="sm"
                      onClick={() => void handleUndo(batch.batchId)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
