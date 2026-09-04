import { useTranslation } from "react-i18next";
import { Info, Lightbulb, Sparkles } from "../theme/icons";
import { Modal } from "./Modal";
import { SectionLabel } from "./SectionLabel";
import { Button } from "./Button";
import type { SettingsGuideEntry } from "../lib/settingsGuide";

/** 设置项说明弹窗：功能介绍 / 情景举例 / 设置说明，与说明中心共用同一数据源。 */
export function SettingsInfoDialog({
  open,
  entry,
  onClose,
}: {
  open: boolean;
  entry: SettingsGuideEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open && entry !== null}
      title={entry ? t(entry.titleKey) : ""}
      onClose={onClose}
      width="max-w-md"
      brandTitle
      footer={
        <Button variant="primary" size="md" onClick={onClose}>
          {t("settings.infoClose")}
        </Button>
      }
    >
      {entry && (
        <div className="space-y-5">
          <section>
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <SectionLabel
                tone="strong"
                className="text-brand-700 dark:text-brand-300"
              >
                {t("settings.infoIntro")}
              </SectionLabel>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-secondary">
              {t(entry.introKey)}
            </p>
          </section>
          <section>
            <div className="flex items-center gap-1.5">
              <Lightbulb className="size-4 shrink-0 text-amber-500 dark:text-amber-400" />
              <SectionLabel
                tone="strong"
                className="text-brand-700 dark:text-brand-300"
              >
                {t("settings.infoExample")}
              </SectionLabel>
            </div>
            <div className="mt-1.5 rounded-lg border-l-2 border-brand-400 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-secondary dark:border-brand-500/50 dark:bg-slate-800">
              {t(entry.exampleKey)}
            </div>
          </section>
          <section>
            <div className="flex items-center gap-1.5">
              <Info className="size-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <SectionLabel>{t("settings.infoTips")}</SectionLabel>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {t(entry.tipsKey)}
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}
