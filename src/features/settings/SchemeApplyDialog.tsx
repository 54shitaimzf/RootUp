import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { RULE_PRESETS } from "../../lib/presets";
import type { CurrentScheme } from "../../lib/effectiveMap";
import type { RuleScheme } from "../../lib/tauri";
import { Button } from "../../components/Button";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Modal } from "../../components/Modal";
import { SectionLabel } from "../../components/SectionLabel";

/**
 * 应用方案弹窗：与其它编辑弹窗统一为居中模态 + 吸底按钮。
 * 内置模板与自定义方案分组展示，当前使用中的方案带标记；
 * 先选择方案，再两步确认应用，避免与“当前方案”混淆。
 */
export function SchemeApplyDialog({
  open,
  schemes,
  current,
  onApply,
  onClose,
}: {
  open: boolean;
  schemes: RuleScheme[];
  current: CurrentScheme;
  onApply: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(null);
    }
  }, [open]);

  const isCurrentBuiltin = (nameKey: string) =>
    current.kind === "builtin" && current.nameKey === nameKey;
  const isCurrentCustom = (name: string) =>
    current.kind === "custom" && current.name === name;

  const select = (id: string) => {
    setSelectedId(id);
  };

  return (
    <Modal
      open={open}
      title={t("settings.applySchemeMenuTitle")}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <ConfirmButton
            label={t("settings.applySelected")}
            pendingLabel={t("settings.confirmApplySelected")}
            variant="primary"
            pendingVariant="amber"
            size="md"
            disabled={!selectedId}
            onConfirm={() => {
              if (!selectedId) return;
              onApply(selectedId);
              onClose();
            }}
          />
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted">
        {t("settings.applySchemeHint")}
      </p>
      <div className="mt-3">
        <SectionLabel size="xs" className="px-1 pb-1 uppercase tracking-wide">
          {t("settings.builtinPresets")}
        </SectionLabel>
        <div className="space-y-1">
          {RULE_PRESETS.map((preset) => {
            const isSelected = selectedId === preset.id;
            const isCurrent = isCurrentBuiltin(preset.nameKey);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => select(preset.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{t(preset.nameKey)}</span>
                {isCurrent && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {t("settings.currentSchemeTag")}
                  </span>
                )}
                {isSelected && <Check className="size-4 shrink-0" />}
              </button>
            );
          })}
        </div>
        {schemes.length > 0 && (
          <>
            <SectionLabel
              size="xs"
              className="px-1 pb-1 pt-3 uppercase tracking-wide"
            >
              {t("settings.customSchemes")}
            </SectionLabel>
            <div className="space-y-1">
              {schemes.map((scheme) => {
                const isSelected = selectedId === scheme.id;
                const isCurrent = isCurrentCustom(scheme.name);
                return (
                  <button
                    key={scheme.id}
                    type="button"
                    onClick={() => select(scheme.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{scheme.name}</span>
                    {isCurrent && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t("settings.currentSchemeTag")}
                      </span>
                    )}
                    {isSelected && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
