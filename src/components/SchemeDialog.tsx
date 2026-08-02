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
} from "../lib/tauri";
import { Button } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { Modal } from "./Modal";

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
      footer={
        <Button variant="ghost" size="md" onClick={onClose}>
          {t("settings.dialogClose")}
        </Button>
      }
    >
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {t("settings.schemeSaveHint")}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          placeholder={t("settings.schemeNamePlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
        />
        <Button variant="primary" size="sm" onClick={() => void save()}>
          {t("settings.schemeSave")}
        </Button>
      </div>
      {message && (
        <p className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {t("settings.customSchemes")}
        </div>
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
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commitRename();
                    }}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => void commitRename()}
                    aria-label={t("settings.schemeRename")}
                    className="rounded p-1 text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    aria-label={t("settings.cancel")}
                    className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="size-3.5" />
                  </button>
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
                    <button
                      type="button"
                      onClick={() => startRename(scheme)}
                      aria-label={t("settings.schemeRename")}
                      className="rounded p-1 text-slate-400 transition-colors hover:text-brand-600 dark:hover:text-brand-300"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <ConfirmButton
                      label={<Trash2 className="size-3.5" />}
                      pendingLabel={t("settings.schemeConfirmDelete")}
                      onConfirm={() => void handleDelete(scheme.id)}
                      className="rounded p-1 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-500"
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
