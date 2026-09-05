import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FolderOpen, Undo2 } from "../../../theme/icons";
import {
  assessArchiveRoot,
  listArchiveBatches,
  openDirectoryDialog,
  recommendedArchiveRoots,
  undoArchive,
  type ArchiveAssessment,
  type ArchiveBatch,
} from "../../../lib/tauri";
import { errorCode, errorMessage } from "../../../lib/errors";
import { formatTimestamp } from "../../../lib/fileUtils";
import { Banner } from "../../../components/Banner";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { IconButton } from "../../../components/IconButton";
import { InlineNotice } from "../../../components/InlineNotice";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { SectionLabel } from "../../../components/SectionLabel";
import { Tooltip } from "../../../components/Tooltip";

/** 归档根安全评估防抖时长（输入停顿后即时告警）。 */
const ASSESS_DEBOUNCE_MS = 300;

/** reason 标识 → i18n key（guardReason_<reason>，与 core/archive_guard 清单对应）。 */
function reasonKey(reason: string | null): string {
  if (!reason) return "settings.guardReason_generic";
  const key = `settings.guardReason_${reason}`;
  return key;
}

/**
 * 归档设置弹窗：归档根目录（实时安全评估 + 推荐位置 + 危险位置拦截）、
 * 自动归档开关（开启需确认后果）、最近归档（可撤销）。
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
  const [assessment, setAssessment] = useState<ArchiveAssessment | null>(null);
  const [recommended, setRecommended] = useState<string[]>([]);
  const [autoConfirmOpen, setAutoConfirmOpen] = useState(false);
  const [warnConfirmOpen, setWarnConfirmOpen] = useState(false);
  const assessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setRootInput(root);
    setAuto(autoArchive);
    setError(null);
    listArchiveBatches(50)
      .then(setBatches)
      .catch(() => setBatches([]));
    recommendedArchiveRoots()
      .then(setRecommended)
      .catch(() => setRecommended([]));
  }, [open, root, autoArchive]);

  // 输入变化 → 防抖评估归档根安全性（空值视为未配置，不告警）
  useEffect(() => {
    if (!open) return;
    if (assessTimer.current) clearTimeout(assessTimer.current);
    const value = rootInput.trim();
    if (!value) {
      setAssessment(null);
      return;
    }
    assessTimer.current = setTimeout(() => {
      assessArchiveRoot(value)
        .then(setAssessment)
        .catch(() => setAssessment(null));
    }, ASSESS_DEBOUNCE_MS);
    return () => {
      if (assessTimer.current) clearTimeout(assessTimer.current);
    };
  }, [rootInput, open]);

  const blocked = assessment?.level === "blocked";
  const warned = assessment?.level === "warn";

  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ archive_root: rootInput.trim(), auto_archive: auto });
      onClose();
    } catch (err) {
      // 后端拦截（archive_guard.blocked 等）以 code|message 返回，展示剥离后的文案
      setError(errorCode(err) ? errorMessage(err) : String(err));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (blocked) return;
    if (warned) {
      // 常用目录作归档根：二次确认（danger 语义）
      setWarnConfirmOpen(true);
      return;
    }
    void doSave();
  };

  const toggleAuto = () => {
    if (auto) {
      setAuto(false);
      return;
    }
    // 开启方向有实际后果：确认后生效；关闭方向直接生效
    setAutoConfirmOpen(true);
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
          <Button
            variant="primary"
            size="md"
            disabled={saving || blocked}
            onClick={save}
          >
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
          {assessment && blocked && (
            <Banner variant="error" className="mt-2">
              <span className="font-semibold">
                {t("settings.archiveGuardBlocked")}
              </span>{" "}
              {t(reasonKey(assessment.reason))}
            </Banner>
          )}
          {assessment && warned && (
            <Banner variant="warn" className="mt-2">
              <span className="font-semibold">{t("settings.archiveGuardWarn")}</span>{" "}
              {t(reasonKey(assessment.reason))}
            </Banner>
          )}
          {recommended.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-muted">{t("settings.recommendedTitle")}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {recommended.map((candidate) => (
                  <Tooltip key={candidate} content={candidate} className="inline-block">
                    <Button
                      variant={rootInput === candidate ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setRootInput(candidate)}
                    >
                      <span className="max-w-56 truncate font-mono text-xs">
                        {candidate}
                      </span>
                    </Button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <SectionLabel>{t("settings.autoArchiveLabel")}</SectionLabel>
          <p className="mt-1 text-xs text-muted">{t("settings.autoArchiveHint")}</p>
          <Button
            variant={auto ? "amber" : "secondary"}
            size="sm"
            icon={auto ? AlertTriangle : undefined}
            className="mt-2"
            onClick={toggleAuto}
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

      <ConfirmDialog
        open={autoConfirmOpen}
        title={t("settings.autoArchiveConfirmTitle")}
        description={t("settings.autoArchiveConfirmBody")}
        confirmLabel={t("settings.autoArchiveConfirmAction")}
        danger
        onConfirm={() => {
          setAutoConfirmOpen(false);
          setAuto(true);
        }}
        onCancel={() => setAutoConfirmOpen(false)}
      />

      <ConfirmDialog
        open={warnConfirmOpen}
        title={t("settings.archiveGuardWarn")}
        description={t(reasonKey(assessment?.reason ?? null))}
        confirmLabel={t("settings.confirmSave")}
        danger
        onConfirm={() => {
          setWarnConfirmOpen(false);
          void doSave();
        }}
        onCancel={() => setWarnConfirmOpen(false)}
      />
    </Modal>
  );
}
