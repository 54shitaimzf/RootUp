import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Trash2, X } from "lucide-react";
import {
  deleteScheme,
  renameScheme,
  saveScheme,
  type ClassifyRule,
  type IgnoreRules,
  type RuleScheme,
} from "../../../lib/tauri";
import { Button } from "../../../components/Button";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { IconButton } from "../../../components/IconButton";
import { InlineNotice } from "../../../components/InlineNotice";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { SectionLabel } from "../../../components/SectionLabel";
import { isComposing } from "../../../lib/ime";

const MAX_NAME_LEN = 40;

/** 保存为方案 / 管理自定义方案：轻量命名框 + 重命名 / 删除。 */
export function SchemeDialog({
  open,
  schemes,
  current,
  onChanged,
  onClose,
}: {
  open: boolean;
  schemes: RuleScheme[];
  current: { ignore_rules: IgnoreRules; classify_overrides: ClassifyRule[] };
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setMessage(null);
      setError(null);
      setRenamingId(null);
    }
  }, [open]);

  const friendlyError = (err: unknown) => {
    const raw = String(err);
    if (raw.includes("已存在")) return t("settings.schemeNameExists");
    if (raw.includes("上限")) return t("settings.schemeLimit");
    return raw;
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || [...trimmed].length > MAX_NAME_LEN) {
      setError(t("settings.schemeNameInvalid"));
      return;
    }
    try {
      await saveScheme(trimmed, current.ignore_rules, current.classify_overrides);
      setName("");
      setError(null);
      setMessage(t("settings.schemeSaved"));
      await onChanged();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const startRename = (scheme: RuleScheme) => {
    setRenamingId(scheme.id);
    setRenameValue(scheme.name);
    setError(null);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed || [...trimmed].length > MAX_NAME_LEN) {
      setError(t("settings.schemeNameInvalid"));
      return;
    }
    try {
      await renameScheme(renamingId, trimmed);
      setRenamingId(null);
      setError(null);
      setMessage(t("settings.schemeRenamed"));
      await onChanged();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScheme(id);
      setError(null);
      setMessage(t("settings.schemeDeleted"));
      await onChanged();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <Modal
      open={open}
      title={t("settings.schemeDialogTitle")}
      onClose={onClose}
      width="max-w-md"
      brandTitle
      footer={
        <Button variant="ghost" size="md" onClick={onClose}>
          {t("settings.dialogClose")}
        </Button>
      }
    >
      <div className="text-xs text-muted">
        {t("settings.schemeSaveHint")}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          size="sm"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (isComposing(event)) return;
            if (event.key === "Enter") void save();
          }}
          placeholder={t("settings.schemeNamePlaceholder")}
          className="flex-1"
        />
        <Button variant="primary" size="sm" onClick={() => void save()}>
          {t("settings.schemeSave")}
        </Button>
      </div>
      {message && (
        <InlineNotice variant="success" className="mt-2">
          {message}
        </InlineNotice>
      )}
      {error && (
        <InlineNotice variant="error" className="mt-2">
          {error}
        </InlineNotice>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <SectionLabel>
          {t("settings.customSchemes")}
        </SectionLabel>
        <div className="mt-2 space-y-1">
          {schemes.length === 0 ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {t("settings.schemeEmpty")}
            </span>
          ) : (
            schemes.map((scheme) =>
              renamingId === scheme.id ? (
                <div
                  key={scheme.id}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 dark:bg-slate-800"
                >
                  <Input
                    size="sm"
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (isComposing(event)) return;
                      if (event.key === "Enter") void commitRename();
                    }}
                    className="flex-1 !border-slate-200 !bg-white dark:!border-slate-700 dark:!bg-slate-900"
                  />
                  <IconButton
                    label={t("settings.schemeRename")}
                    icon={Check}
                    tone="brand"
                    size="sm"
                    onClick={() => void commitRename()}
                  />
                  <IconButton
                    label={t("settings.cancel")}
                    icon={X}
                    tone="neutral"
                    size="sm"
                    onClick={() => setRenamingId(null)}
                  />
                </div>
              ) : (
                <div
                  key={scheme.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5 dark:bg-slate-800"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                    {scheme.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={t("settings.schemeRename")}
                      icon={Pencil}
                      tone="brand"
                      size="sm"
                      onClick={() => startRename(scheme)}
                    />
                    <ConfirmButton
                      label={<Trash2 className="size-3.5" />}
                      pendingLabel={t("settings.schemeConfirmDelete")}
                      onConfirm={() => void handleDelete(scheme.id)}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-500/15"
                      pendingClassName="rounded bg-red-50 px-2 text-[10px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400"
                    />
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
