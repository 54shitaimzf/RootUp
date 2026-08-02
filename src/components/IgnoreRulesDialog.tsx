import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IgnoreRules } from "../lib/tauri";
import { Button } from "./Button";
import { ChipGroup } from "./ChipGroup";
import { Modal } from "./Modal";

export function IgnoreRulesDialog({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: IgnoreRules;
  onSave: (rules: IgnoreRules) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<IgnoreRules>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setError(null);
    }
  }, [open, initial]);

  const addExtension = (value: string) => {
    const ext = value.trim().toLowerCase().replace(/\./g, "");
    if (!ext) return;
    if (draft.extensions.includes(ext)) {
      setError(t("settings.ruleDuplicate"));
      return;
    }
    setDraft((prev) => ({ ...prev, extensions: [...prev.extensions, ext] }));
    setError(null);
  };
  const addPrefix = (value: string) => {
    if (draft.prefixes.includes(value)) {
      setError(t("settings.ruleDuplicate"));
      return;
    }
    setDraft((prev) => ({ ...prev, prefixes: [...prev.prefixes, value] }));
    setError(null);
  };
  const addExact = (value: string) => {
    if (draft.exact_names.includes(value)) {
      setError(t("settings.ruleDuplicate"));
      return;
    }
    setDraft((prev) => ({ ...prev, exact_names: [...prev.exact_names, value] }));
    setError(null);
  };

  const save = async () => {
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Modal
      open={open}
      title={t("settings.ignoreDialogTitle")}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={() => void save()}>
            {t("settings.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}
        <div>
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("settings.ignoreExtensions")}
          </div>
          <div className="mt-1.5">
            <ChipGroup
              items={draft.extensions}
              onAdd={addExtension}
              onRemove={(value) =>
                setDraft((prev) => ({
                  ...prev,
                  extensions: prev.extensions.filter((e) => e !== value),
                }))
              }
              placeholder={t("settings.ignoreExtPlaceholder")}
              addLabel={t("settings.addIgnore")}
            />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("settings.ignorePrefixes")}
          </div>
          <div className="mt-1.5">
            <ChipGroup
              items={draft.prefixes}
              onAdd={addPrefix}
              onRemove={(value) =>
                setDraft((prev) => ({
                  ...prev,
                  prefixes: prev.prefixes.filter((p) => p !== value),
                }))
              }
              placeholder={t("settings.ignorePrefixPlaceholder")}
              addLabel={t("settings.addIgnore")}
            />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("settings.ignoreExactNames")}
          </div>
          <div className="mt-1.5">
            <ChipGroup
              items={draft.exact_names}
              onAdd={addExact}
              onRemove={(value) =>
                setDraft((prev) => ({
                  ...prev,
                  exact_names: prev.exact_names.filter((n) => n !== value),
                }))
              }
              placeholder={t("settings.ignoreExactPlaceholder")}
              addLabel={t("settings.addIgnore")}
            />
          </div>
        </div>
        <p className="border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
          {t("settings.restartHint")}
        </p>
      </div>
    </Modal>
  );
}
