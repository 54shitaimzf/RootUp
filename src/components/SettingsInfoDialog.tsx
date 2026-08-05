import { useTranslation } from "react-i18next";
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
      footer={
        <Button variant="primary" size="md" onClick={onClose}>
          {t("settings.infoClose")}
        </Button>
      }
    >
      {entry && (
        <div className="space-y-4">
          <div>
            <SectionLabel>{t("settings.infoIntro")}</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              {t(entry.introKey)}
            </p>
          </div>
          <div>
            <SectionLabel>{t("settings.infoExample")}</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              {t(entry.exampleKey)}
            </p>
          </div>
          <div>
            <SectionLabel>{t("settings.infoTips")}</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              {t(entry.tipsKey)}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
