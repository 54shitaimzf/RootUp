import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ExternalLink,
  GraduationCap,
  Info,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  Search,
  Settings2,
} from "lucide-react";
import { Modal } from "./Modal";
import { SectionLabel } from "./SectionLabel";
import { SyntaxTable } from "./SyntaxTable";
import { Button } from "./Button";
import { InlineNotice } from "./InlineNotice";
import { Input } from "./Input";
import { OnboardingDialog, OnboardingSteps, isOnboardingDone } from "./OnboardingDialog";
import { HelpArticleCard } from "./HelpArticleCard";
import { IDE_GUIDE, LANGUAGE_IDE_RECOMMENDATION } from "../lib/ideGuide";
import { SETTINGS_GUIDE, SETTINGS_GUIDE_GROUPS } from "../lib/settingsGuide";
import {
  HELP_ARTICLE_IDS,
  HELP_ARTICLES,
  HELP_SEARCH_SOURCES,
  HELP_TAB_IDS,
  HELP_TABS,
  currentWhatsNew,
  type HelpTab,
} from "../lib/helpContent";
import { searchHelp } from "../lib/helpSearch";
import {
  loadHelpFeedback,
  saveHelpVote,
  type HelpVote,
} from "../lib/helpFeedback";
import type { PageKey } from "../lib/nav";
import { listDetectedTools, logEvent, openUrl } from "../lib/tauri";

interface HelpContextValue {
  /** 传入文章 id（如 tasks.files）直达文章；传入分区 id（如 settings）打开分区；缺省打开新手入门 */
  openHelp: (target?: string) => void;
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

const TAB_ICONS: Record<HelpTab, typeof GraduationCap> = {
  guide: GraduationCap,
  tasks: ListChecks,
  syntax: Search,
  settings: Settings2,
  troubleshoot: LifeBuoy,
};

/** 全局帮助中心：侧栏入口 + 首次引导 + 分组帮助弹窗。 */
export function HelpCenterProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  /** 文章“动作按钮”跳转页面用；可选，缺省时动作按钮仅展示 */
  onNavigate?: (page: PageKey) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [section, setSection] = useState<HelpTab>("guide");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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

  const openHelp = (target?: string) => {
    if (target && HELP_ARTICLE_IDS.has(target)) {
      const article = HELP_ARTICLES.find((item) => item.id === target);
      if (article) {
        setSection(article.tab);
        setExpandedArticle(target);
      }
    } else if (target && HELP_TAB_IDS.has(target)) {
      setSection(target as HelpTab);
      setExpandedArticle(null);
    } else {
      setSection("guide");
      setExpandedArticle(null);
    }
    setQuery("");
    setHelpOpen(true);
  };

  const closeHelp = () => {
    setQuery("");
    setExpandedArticle(null);
    setHelpOpen(false);
  };

  const openSection = (tab: HelpTab) => {
    setSection(tab);
    setExpandedArticle(null);
    setQuery("");
  };

  const openArticle = (articleId: string) => {
    const article = HELP_ARTICLES.find((item) => item.id === articleId);
    if (!article) return;
    setSection(article.tab);
    setExpandedArticle(articleId);
    setQuery("");
  };

  const toggleArticle = (articleId: string) => {
    setExpandedArticle((prev) => (prev === articleId ? null : articleId));
  };

  return (
    <HelpContext.Provider
      value={{
        openHelp,
        showOnboarding: () => setOnboardingOpen(true),
      }}
    >
      {children}
      <HelpCenterDialog
        open={helpOpen}
        section={section}
        expandedArticle={expandedArticle}
        query={query}
        detected={detected}
        onOpenSection={openSection}
        onOpenArticle={openArticle}
        onToggleArticle={toggleArticle}
        onSetQuery={setQuery}
        onClose={closeHelp}
        onShowOnboarding={() => setOnboardingOpen(true)}
        onNavigate={onNavigate}
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
  expandedArticle,
  query,
  detected,
  onOpenSection,
  onOpenArticle,
  onToggleArticle,
  onSetQuery,
  onClose,
  onShowOnboarding,
  onNavigate,
}: {
  open: boolean;
  section: HelpTab;
  expandedArticle: string | null;
  query: string;
  detected: string[] | null;
  onOpenSection: (tab: HelpTab) => void;
  onOpenArticle: (articleId: string) => void;
  onToggleArticle: (articleId: string) => void;
  onSetQuery: (value: string) => void;
  onClose: () => void;
  onShowOnboarding: () => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        SETTINGS_GUIDE_GROUPS.slice(1).map((group) => group.id),
      ),
  );
  const [feedback, setFeedback] = useState<Record<string, HelpVote>>(
    loadHelpFeedback,
  );
  const whatsNew = currentWhatsNew();

  const searchResults = useMemo(
    () =>
      searchHelp(
        query,
        (key) => String(t(key)),
        HELP_SEARCH_SOURCES,
      ),
    [query, t],
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

  const renderArticleList = (tab: "tasks" | "troubleshoot") => (
    <div className="mt-4 space-y-3">
      {HELP_ARTICLES.filter((article) => article.tab === tab).map((article) => (
        <HelpArticleCard
          key={article.id}
          article={article}
          expanded={expandedArticle === article.id}
          vote={feedback[article.id]}
          onToggle={() => onToggleArticle(article.id)}
          onOpen={onOpenArticle}
          onAction={(page) => {
            onNavigate?.(page);
            onClose();
          }}
          onVote={(vote) => {
            setFeedback(saveHelpVote(article.id, vote));
          }}
        />
      ))}
    </div>
  );

  return (
    <Modal
      open={open}
      title={t("help.title")}
      onClose={onClose}
      width="max-w-xl"
      brandTitle
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          size="md"
          value={query}
          onChange={(event) => onSetQuery(event.target.value)}
          placeholder={t("helpSearch.placeholder")}
          aria-label={t("helpSearch.placeholder")}
          className="pl-8"
        />
      </div>

      <div className="mt-3 flex gap-1 rounded-md bg-slate-100 p-1 dark:bg-slate-800">
        {HELP_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onOpenSection(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                section === tab.id && !query.trim()
                  ? "bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {query.trim() ? (
        searchResults.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted">
            {t("helpSearch.noResults")}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {searchResults.map((result) => {
              const source = HELP_SEARCH_SOURCES.find(
                (item) => item.id === result.id,
              );
              if (!source) return null;
              const tab = HELP_TABS.find((item) => item.id === source.tab);
              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => onOpenArticle(source.id)}
                  className="w-full rounded-lg bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/70"
                >
                  <span className="flex items-center gap-2">
                    {tab && (
                      <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        {t(tab.labelKey)}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-strong">
                      {t(source.titleKey)}
                    </span>
                  </span>
                  {source.summaryKey && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {t(source.summaryKey)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )
      ) : section === "guide" ? (
        <div className="mt-4 space-y-4">
          {whatsNew && (
            <div>
              <SectionLabel tone="brand" bar>
                {t("help.whatsNewTitle", { version: whatsNew.version })}
              </SectionLabel>
              <div className="mt-2 space-y-1.5">
                {whatsNew.items.map((itemKey) => (
                  <div
                    key={itemKey}
                    className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-secondary dark:bg-slate-800"
                  >
                    {t(itemKey)}
                  </div>
                ))}
              </div>
            </div>
          )}
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
      ) : section === "tasks" || section === "troubleshoot" ? (
        renderArticleList(section)
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
