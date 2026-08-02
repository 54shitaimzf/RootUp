import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { RULE_PRESETS } from "../lib/presets";
import type { CurrentScheme } from "../lib/effectiveMap";
import type { RuleScheme } from "../lib/tauri";

interface MenuAnchor {
  top: number;
  left: number;
}

/**
 * 应用方案二级菜单：内置模板与自定义方案分组展示，
 * 当前方案带标记；先选择、再两步确认应用，避免与“当前方案”混淆。
 */
export function SchemeApplyMenu({
  open,
  anchor,
  schemes,
  current,
  onApply,
  onClose,
}: {
  open: boolean;
  anchor: MenuAnchor | null;
  schemes: RuleScheme[];
  current: CurrentScheme;
  onApply: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setPendingApply(false);
    }
  }, [open]);

  if (!open || !anchor) return null;

  const isCurrentBuiltin = (nameKey: string) =>
    current.kind === "builtin" && current.nameKey === nameKey;
  const isCurrentCustom = (name: string) =>
    current.kind === "custom" && current.name === name;

  const select = (id: string) => {
    setSelectedId(id);
    setPendingApply(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        className="fixed z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900"
        style={{ top: anchor.top, left: anchor.left }}
      >
        <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {t("settings.applySchemeMenuTitle")}
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t("settings.builtinPresets")}
          </div>
          {RULE_PRESETS.map((preset) => {
            const isCurrent = isCurrentBuiltin(preset.nameKey);
            return (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={selectedId === preset.id}
                onClick={() => select(preset.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  selectedId === preset.id
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{t(preset.nameKey)}</span>
                {selectedId === preset.id && <Check className="size-3.5 shrink-0" />}
                {isCurrent && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {t("settings.currentSchemeTag")}
                  </span>
                )}
              </button>
            );
          })}
          {schemes.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t("settings.customSchemes")}
              </div>
              {schemes.map((scheme) => {
                const isCurrent = isCurrentCustom(scheme.name);
                return (
                  <button
                    key={scheme.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedId === scheme.id}
                    onClick={() => select(scheme.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      selectedId === scheme.id
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{scheme.name}</span>
                    {selectedId === scheme.id && <Check className="size-3.5 shrink-0" />}
                    {isCurrent && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t("settings.currentSchemeTag")}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          {selectedId ? (
            <button
              type="button"
              onClick={() => {
                if (!pendingApply) {
                  setPendingApply(true);
                  return;
                }
                onApply(selectedId);
                onClose();
              }}
              className={`w-full rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors ${
                pendingApply
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-brand-700 hover:bg-brand-800"
              }`}
            >
              {pendingApply ? t("settings.confirmApply") : t("settings.applyScheme")}
            </button>
          ) : (
            <span className="w-full px-1 py-1.5 text-center text-[11px] text-slate-400 dark:text-slate-500">
              {t("settings.selectSchemeHint")}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
