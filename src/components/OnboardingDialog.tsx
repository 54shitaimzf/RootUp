import { useTranslation } from "react-i18next";
import { FolderKanban, FolderOpen, Palette } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export const ONBOARDING_STORAGE_KEY = "rootup.onboarding.v1";

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    // localStorage 不可用时静默（仅影响一次性标记）
  }
}

const STEPS = [
  {
    icon: Palette,
    titleKey: "help.onboardingStep1Title",
    descKey: "help.onboardingStep1Desc",
  },
  {
    icon: FolderOpen,
    titleKey: "help.onboardingStep2Title",
    descKey: "help.onboardingStep2Desc",
  },
  {
    icon: FolderKanban,
    titleKey: "help.onboardingStep3Title",
    descKey: "help.onboardingStep3Desc",
  },
];

/** 三步上手内容（欢迎弹窗与帮助中心共用）。 */
export function OnboardingSteps() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        return (
          <div
            key={step.titleKey}
            className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-700 text-xs font-semibold text-white">
              {index + 1}
            </span>
            <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-secondary">
                {t(step.titleKey)}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted">
                {t(step.descKey)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 首次启动欢迎弹窗（localStorage 一次性，帮助中心可重看）。 */
export function OnboardingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const done = () => {
    markOnboardingDone();
    onClose();
  };
  return (
    <Modal
      open={open}
      title={t("help.onboardingTitle")}
      onClose={done}
      width="max-w-md"
      footer={
        <>
          <Button variant="primary" size="md" onClick={done}>
            {t("help.start")}
          </Button>
          <Button variant="ghost" size="md" onClick={done}>
            {t("help.skip")}
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted">{t("help.onboardingIntro")}</p>
      <div className="mt-3">
        <OnboardingSteps />
      </div>
    </Modal>
  );
}
