import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ExternalLink,
  GraduationCap,
  Info,
  Lightbulb,
  Search,
  Settings2,
} from "lucide-react";
import { Modal } from "./Modal";
import { SectionLabel } from "./SectionLabel";
import { SyntaxTable } from "./SyntaxTable";
import { Button } from "./Button";
import { InlineNotice } from "./InlineNotice";
import { OnboardingDialog, OnboardingSteps, isOnboardingDone } from "./OnboardingDialog";
import { IDE_GUIDE, LANGUAGE_IDE_RECOMMENDATION } from "../lib/ideGuide";
import { SETTINGS_GUIDE, SETTINGS_GUIDE_GROUPS } from "../lib/settingsGuide";
import { listDetectedTools, logEvent, openUrl } from "../lib/tauri";

export type HelpSection = "guide" | "syntax" | "settings";

interface HelpContextValue {
  openHelp: (section?: HelpSection) => void;
  showOnboarding: () => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

export function useHelpCenter() {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error("useHelpCenter 必须在 HelpCenterProvider 内使用");
  }
  return ctx;
}

/** 全局帮助中心：侧栏入口 + 首次引导 + 分组帮助弹窗。 */
export function HelpCenterProvider({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [section, setSection] = useState<HelpSection>("guide");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [detected, setDetected] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isOnboardingDone()) {
      setOnboardingOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    let cancelled = false;
    listDetectedTools()
      .then((tools) => {
        if (!cancelled) setDetected(tools);
      })
      .catch(() => {
        if (!cancelled) setDetected([]);
      });
    return () => {
      cancelled = true;
    };
  }, [helpOpen]);

  return (
    <HelpContext.Provider
      value={{
        openHelp: (next) => {
          setSection(next ?? "guide");
          setHelpOpen(true);
        },
        showOnboarding: () => setOnboardingOpen(true),
      }}
    >
      {children}
      <HelpCenterDialog
        open={helpOpen}
        section={section}
        detected={detected}
        onOpenSection={setSection}
        onClose={() => setHelpOpen(false)}
        onShowOnboarding={() => setOnboardingOpen(true)}
      />
      <OnboardingDialog
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
      />
    </HelpContext.Provider>
  );
}

function HelpCenterDialog({
  open,
  section,
  detected,
  onOpenSection,
  onClose,
  onShowOnboarding,
}: {
  open: boolean;
  section: HelpSection;
  detected: string[] | null;
  onOpenSection: (section: HelpSection) => void;
  onClose: () => void;
  onShowOnboarding: () => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        SETTINGS_GUIDE_GROUPS.slice(1).map((group) => group.id),
      ),
  );

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openIdeUrl = async (url: string, key: string) => {
    try {
      await openUrl(url);
      void logEvent("info", `ui: 打开 IDE 下载页 ${key}`);
    } catch (err) {
      void logEvent("warn", `打开下载页失败: ${String(err)}`);
    }
  };

  return (
    <Modal
      open={open}
      title={t("help.title")}
      onClose={onClose}
      width="max-w-xl"
      brandTitle
    >
      <div className="flex gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            ["guide", "help.sectionGuide"],
            ["syntax", "help.sectionSyntax"],
            ["settings", "help.sectionSettings"],
          ] as [HelpSection, string][]
        ).map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            onClick={() => onOpenSection(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              section === key
                ? "bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {key === "guide" ? (
              <GraduationCap className="size-3.5" />
            ) : key === "settings" ? (
              <Settings2 className="size-3.5" />
            ) : (
              <Search className="size-3.5" />
            )}
            {t(labelKey)}
          </button>
        ))}
      </div>

      {section === "guide" ? (
        <div className="mt-4 space-y-4">
          <div>
            <SectionLabel tone="brand" bar>
              {t("help.onboardingTitle")}
            </SectionLabel>
            <p className="mt-1 text-xs text-muted">
              {t("help.onboardingIntro")}
            </p>
            <div className="mt-2">
              <OnboardingSteps />
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={onShowOnboarding}
            >
              {t("help.viewOnboarding")}
            </Button>
          </div>

          <div>
            <SectionLabel tone="brand" bar>
              {t("help.ideGuideTitle")}
            </SectionLabel>
            <p className="mt-1 text-xs text-muted">{t("help.ideGuideIntro")}</p>
            <div className="mt-2 space-y-1.5">
              {LANGUAGE_IDE_RECOMMENDATION.map((rec) => (
                <div
                  key={rec.labelKey}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800"
                >
                  <span className="w-20 shrink-0 text-xs font-medium text-secondary">
                    {t(rec.labelKey)}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {rec.ides.map((key) => {
                      const entry = IDE_GUIDE.find((e) => e.key === key);
                      if (!entry) return null;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => void openIdeUrl(entry.url, entry.key)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300"
                        >
                          {entry.name}
                          <ExternalLink className="size-3" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {t("help.ideAfterInstall")}
            </p>
            {detected && (
              <InlineNotice variant="info" className="mt-2">
                {detected.length > 0
                  ? t("help.detectedTools", { tools: detected.join("、") })
                  : t("help.detectedToolsNone")}
              </InlineNotice>
            )}
          </div>
        </div>
      ) : section === "settings" ? (
        <div className="mt-4 space-y-5">
          {SETTINGS_GUIDE_GROUPS.map((group) => {
            const entries = SETTINGS_GUIDE.filter(
              (entry) => entry.group === group.id,
            );
            const isCollapsed = collapsed.has(group.id);
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 bg-slate-50/60 px-3 py-2.5 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300">
                      <span
                        aria-hidden="true"
                        className="h-[1em] w-0.5 shrink-0 rounded-sm bg-brand-500"
                      />
                      <span className="min-w-0">{t(group.titleKey)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {t(group.descriptionKey)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    {entries.length}
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted transition-transform duration-[var(--duration-fast)] ${
                      isCollapsed ? "" : "rotate-180"
                    }`}
                  />
                </button>
                {!isCollapsed && (
                  <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-transparent transition-colors hover:bg-slate-100 hover:ring-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/70 dark:hover:ring-slate-700"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="size-1.5 shrink-0 rounded-full bg-brand-500" />
                          <span className="text-sm font-semibold text-strong">
                            {t(entry.titleKey)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-secondary">
                          {t(entry.introKey)}
                        </p>
                        <div className="mt-2 flex items-start gap-1.5">
                          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
                          <p className="text-xs leading-relaxed text-muted">
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              {t("settings.infoExample")}
                            </span>
                            : {t(entry.exampleKey)}
                          </p>
                        </div>
                        <div className="mt-1 flex items-start gap-1.5">
                          <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                          <p className="text-xs leading-relaxed text-muted">
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              {t("settings.infoTips")}
                            </span>
                            : {t(entry.tipsKey)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <SectionLabel tone="brand" bar>
              {t("help.syntaxTitle")}
            </SectionLabel>
            <p className="mt-1 text-xs text-muted">{t("files.syntaxHelpIntro")}</p>
            <div className="mt-2">
              <SyntaxTable />
            </div>
          </div>
          <div>
            <SectionLabel tone="brand" bar>
              {t("help.customCommandsTitle")}
            </SectionLabel>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t("help.customCommandsNote")}
            </p>
          </div>
          <div>
            <SectionLabel tone="brand" bar>
              {t("help.logTitle")}
            </SectionLabel>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t("help.logNote")}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
