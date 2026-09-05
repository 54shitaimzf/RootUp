import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  FolderKanban,
  FolderOpen,
  Palette,
} from "../theme/icons";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Banner } from "./Banner";
import { Input } from "./Input";
import {
  assessArchiveRoot,
  openDirectoryDialog,
  recommendedArchiveRoots,
  updateSettings,
  type ArchiveAssessment,
} from "../lib/tauri";

/** 向导完成标记 v2（v2 新增归档位置步骤；v1 老用户视为已完成，不强制重跑）。 */
export const ONBOARDING_STORAGE_KEY = "rootup.onboarding.v2";
const ONBOARDING_STORAGE_KEY_V1 = "rootup.onboarding.v1";

export function isOnboardingDone(): boolean {
  try {
    return (
      localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1" ||
      // v1 老用户已见过三步引导，不因新增步骤强制重跑
      localStorage.getItem(ONBOARDING_STORAGE_KEY_V1) === "1"
    );
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
    icon: Archive,
    titleKey: "help.onboardingStep3Title",
    descKey: "help.onboardingStep3Desc",
  },
  {
    icon: FolderKanban,
    titleKey: "help.onboardingStep4Title",
    descKey: "help.onboardingStep4Desc",
  },
];

/** 四步上手概览（帮助中心内嵌展示用；交互向导见 OnboardingDialog）。 */
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

const STEP_COUNT = STEPS.length;
/** 归档位置交互步（第 3 步，index 2）：必须做出选择才能进入下一步。 */
const ARCHIVE_STEP_INDEX = 2;

/** 归档位置选择状态：skip=暂不启用；其余以输入路径为准（经安全评估）。 */
type ArchivePick = { kind: "skip" } | { kind: "path"; path: string };

function ArchiveStepBody({
  pick,
  onPick,
}: {
  pick: ArchivePick | null;
  onPick: (pick: ArchivePick) => void;
}) {
  const { t } = useTranslation();
  const [recommended, setRecommended] = useState<string[]>([]);
  const [assessment, setAssessment] = useState<ArchiveAssessment | null>(null);
  const assessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const path = pick?.kind === "path" ? pick.path : "";

  useEffect(() => {
    recommendedArchiveRoots()
      .then(setRecommended)
      .catch(() => setRecommended([]));
  }, []);

  // 路径变化 → 防抖安全评估（即时告警是本步的引导核心）
  useEffect(() => {
    if (assessTimer.current) clearTimeout(assessTimer.current);
    const value = path.trim();
    if (!value) {
      setAssessment(null);
      return;
    }
    assessTimer.current = setTimeout(() => {
      assessArchiveRoot(value)
        .then(setAssessment)
        .catch(() => setAssessment(null));
    }, 300);
    return () => {
      if (assessTimer.current) clearTimeout(assessTimer.current);
    };
  }, [path]);

  const blocked = assessment?.level === "blocked";
  const warned = assessment?.level === "warn";

  const browse = async () => {
    try {
      const dir = await openDirectoryDialog();
      if (dir) onPick({ kind: "path", path: dir });
    } catch {
      // 选择器不可用或用户取消：保留当前输入
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t("help.onboardingStep3Desc")}</p>
      {recommended.length > 0 && (
        <div>
          <p className="text-xs font-medium text-secondary">
            {t("settings.recommendedTitle")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {recommended.map((candidate) => (
              <Button
                key={candidate}
                variant={path === candidate ? "primary" : "secondary"}
                size="sm"
                onClick={() => onPick({ kind: "path", path: candidate })}
              >
                <span className="max-w-56 truncate font-mono text-xs">
                  {candidate}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={path}
          onChange={(event) => onPick({ kind: "path", path: event.target.value })}
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
        <Banner variant="error" padding="sm">
          <span className="font-semibold">{t("settings.archiveGuardBlocked")}</span>{" "}
          {t(`settings.guardReason_${assessment.reason ?? "generic"}`)}
        </Banner>
      )}
      {assessment && warned && (
        <Banner variant="warn" padding="sm">
          <span className="font-semibold">{t("settings.archiveGuardWarn")}</span>{" "}
          {t(`settings.guardReason_${assessment.reason ?? "generic"}`)}
        </Banner>
      )}
      <div>
        <Button
          variant={pick?.kind === "skip" ? "primary" : "secondary"}
          size="sm"
          onClick={() => onPick({ kind: "skip" })}
        >
          {t("help.onboardingArchiveSkip")}
        </Button>
      </div>
    </div>
  );
}

/** 首次启动分步向导（localStorage v2 一次性，帮助中心可重看）。 */
export function OnboardingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState<ArchivePick | null>(null);
  const [warnAcknowledged, setWarnAcknowledged] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [assessment, setAssessment] = useState<ArchiveAssessment | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setPick(null);
      setWarnAcknowledged(false);
      setShowRequired(false);
      setAssessment(null);
    }
  }, [open]);

  // 交互步的路径评估（与 ArchiveStepBody 内部评估并行，用于门禁判断）
  useEffect(() => {
    if (!open || step !== ARCHIVE_STEP_INDEX || pick?.kind !== "path") {
      setAssessment(null);
      return;
    }
    const value = pick.path.trim();
    if (!value) {
      setAssessment(null);
      return;
    }
    const timer = setTimeout(() => {
      assessArchiveRoot(value)
        .then(setAssessment)
        .catch(() => setAssessment(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [open, step, pick]);

  const archiveStepReady =
    pick !== null &&
    (pick.kind === "skip" ||
      (pick.path.trim().length > 0 && assessment?.level !== "blocked"));
  const needWarnConfirm =
    !!pick &&
    pick.kind === "path" &&
    assessment?.level === "warn" &&
    !warnAcknowledged;

  const finish = () => {
    markOnboardingDone();
    onClose();
  };

  const goNext = async () => {
    if (step === ARCHIVE_STEP_INDEX) {
      if (!archiveStepReady) {
        setShowRequired(true);
        return;
      }
      if (needWarnConfirm) {
        // 常用目录作归档根：第一次点击只升级为危险确认态
        setWarnAcknowledged(true);
        return;
      }
      if (pick?.kind === "path") {
        try {
          await updateSettings({ archive_root: pick.path.trim() });
        } catch {
          // 落盘失败不阻塞向导：设置页可随时补配
        }
      }
    }
    setShowRequired(false);
    setWarnAcknowledged(false);
    if (step + 1 >= STEP_COUNT) {
      finish();
    } else {
      setStep(step + 1);
    }
  };

  const goBack = () => {
    setShowRequired(false);
    setWarnAcknowledged(false);
    setStep((value) => Math.max(0, value - 1));
  };

  const current = STEPS[step];
  const CurrentIcon = current.icon;

  return (
    <Modal
      open={open}
      title={t("help.onboardingTitle")}
      onClose={finish}
      width="max-w-md"
      footer={
        <>
          {step + 1 < STEP_COUNT ? (
            <Button
              variant={needWarnConfirm ? "danger" : "primary"}
              size="md"
              onClick={() => void goNext()}
            >
              {needWarnConfirm
                ? t("help.onboardingArchiveUseWarn")
                : t("help.onboardingNext")}
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={finish}>
              {t("help.start")}
            </Button>
          )}
          {step > 0 && (
            <Button variant="ghost" size="md" onClick={goBack}>
              {t("help.onboardingBack")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-xs text-muted">
        {t("help.onboardingIntro")} ({step + 1}/{STEP_COUNT})
      </p>
      <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3.5 dark:bg-slate-800">
        <div className="flex items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-700 text-xs font-semibold text-white">
            {step + 1}
          </span>
          <CurrentIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-secondary">
              {t(current.titleKey)}
            </div>
          </div>
        </div>
        {step === ARCHIVE_STEP_INDEX ? (
          <div className="mt-3">
            <ArchiveStepBody pick={pick} onPick={setPick} />
            {showRequired && !archiveStepReady && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {t("help.onboardingArchiveRequired")}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-1.5 text-xs leading-relaxed text-muted">
            {t(current.descKey)}
          </div>
        )}
      </div>
    </Modal>
  );
}
