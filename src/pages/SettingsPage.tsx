import { useTranslation } from "react-i18next";
import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Globe,
  HelpCircle,
  Languages,
  LogOut,
  Minimize2,
  RefreshCw,
  RotateCcw,
} from "../theme/icons";
import { useSettings } from "../hooks/useSettings";
import type { ScanController } from "../hooks/useScan";
import { isComposing } from "../lib/ime";
import { applyPreset, RULE_PRESETS } from "../lib/presets";
import { LANGUAGE_OPTIONS } from "../lib/languages";
import {
  addWatchedDir,
  countUnderRoot,
  createHomeworkShortcut,
  getLogDir,
  listCategories,
  listClassifyDefaults,
  listLabelDefs,
  listSchemes,
  watchedDirHealth,
  type WatchedDirHealth,
  listCommonDirs,
  removeWatchedDir,
  resetSettings,
  type ClassifyDefaultEntry,
  type ClassifyRule,
  type CloseAction,
  type CommonDirEntry,
  type IgnoreRules,
  type LabelDef,
  type Language,
  type RuleScheme,
  type ThemeMode,
} from "../lib/tauri";
import { SETTINGS_GUIDE, type SettingsGuideEntry } from "../lib/settingsGuide";
import {
  resolveCurrentScheme,
  summarizeIgnoreRules,
} from "../lib/effectiveMap";
import { PREFERRED_IDE_OPTIONS } from "../lib/projects";
import { useTheme } from "../theme/ThemeProvider";
import { FormSection } from "../components/FormSection";
import { DirectoryAdder } from "../components/DirectoryAdder";
import { RevealLink } from "../components/RevealLink";
import { Select } from "../components/Select";
import { SettingsInfoDialog } from "../components/SettingsInfoDialog";
import { Tooltip } from "../components/Tooltip";
import { IgnoreRulesDialog } from "../features/settings/components/IgnoreRulesDialog";
import { ClassifyMappingDialog } from "../features/settings/components/ClassifyMappingDialog";
import { LabelManageDialog } from "../features/settings/components/LabelManageDialog";
import { ArchiveSettingsDialog } from "../features/settings/components/ArchiveSettingsDialog";
import { SchemeDialog } from "../features/settings/components/SchemeDialog";
import { SchemeApplyDialog } from "../features/settings/components/SchemeApplyDialog";
import {
  ProjectOpenDialog,
  type OpenConfig,
} from "../features/settings/components/ProjectOpenDialog";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { IconButton } from "../components/IconButton";
import { PageHeader } from "../components/PageHeader";
import { PageHelpButton } from "../components/PageHelpButton";

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

const CLOSE_ACTION_OPTIONS: {
  value: CloseAction;
  labelKey: string;
  icon: typeof HelpCircle;
}[] = [
  { value: "ask", labelKey: "settings.closeActionAsk", icon: HelpCircle },
  {
    value: "background",
    labelKey: "settings.closeActionBackground",
    icon: Minimize2,
  },
  { value: "quit", labelKey: "settings.closeActionQuit", icon: LogOut },
];

const REMINDER_LEAD_OPTIONS = [1, 2, 3, 5, 7, 14];

function cloneRules(source: {
  ignore_rules: IgnoreRules;
  classify_overrides: ClassifyRule[];
}): { ignore_rules: IgnoreRules; classify_overrides: ClassifyRule[] } {
  return {
    ignore_rules: {
      extensions: [...source.ignore_rules.extensions],
      prefixes: [...source.ignore_rules.prefixes],
      exact_names: [...source.ignore_rules.exact_names],
    },
    classify_overrides: source.classify_overrides.map((rule) => ({
      extensions: [...rule.extensions],
      category: rule.category,
    })),
  };
}

function Row({
  title,
  summary,
  guideId,
  onInfo,
  onEdit,
}: {
  title: string;
  summary: ReactNode;
  guideId: string;
  onInfo: (id: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onInfo(guideId)}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onInfo(guideId);
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3.5 transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/70"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-secondary">
          {title}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {summary}
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        {t("settings.edit")}
      </Button>
    </div>
  );
}

export function SettingsPage({ scan }: { scan: ScanController }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { settings, update, commit, mergeLocal, syncFromBackend } =
    useSettings();
  const language = settings?.language ?? "zh-CN";
  // 监控目录单一数据源：直接派生自全局 settings，禁止持有平行副本
  // （否则任何 replace 全量写都会用旧快照静默丢掉运行期增删的目录）。
  const watchedDirs = settings?.watched_dirs ?? [];
  const [missingDirs, setMissingDirs] = useState<Set<string>>(new Set());
  const [dirError, setDirError] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 规则与分类
  const [defaults, setDefaults] = useState<ClassifyDefaultEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<RuleScheme[]>([]);
  const [applyMenuOpen, setApplyMenuOpen] = useState(false);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [projectOpenOpen, setProjectOpenOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [customLabels, setCustomLabels] = useState<LabelDef[]>([]);
  const [commonDirs, setCommonDirs] = useState<CommonDirEntry[]>([]);
  const [removeTarget, setRemoveTarget] = useState<{
    dir: string;
    count: number;
  } | null>(null);
  const [infoEntry, setInfoEntry] = useState<SettingsGuideEntry | null>(null);

  useEffect(() => {
    watchedDirHealth()
      .then((health: WatchedDirHealth[]) =>
        setMissingDirs(
          new Set(health.filter((item) => !item.exists).map((item) => item.dir)),
        ),
      )
      .catch(() => {});
    getLogDir()
      .then(setLogDir)
      .catch(() => setLogDir(null));
    listClassifyDefaults()
      .then(setDefaults)
      .catch(() => setDefaults([]));
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    listSchemes()
      .then(setSchemes)
      .catch(() => setSchemes([]));
    listLabelDefs()
      .then(setCustomLabels)
      .catch(() => setCustomLabels([]));
    listCommonDirs()
      .then(setCommonDirs)
      .catch(() => setCommonDirs([]));
  }, []);

  const refreshLabels = () => {
    listLabelDefs()
      .then(setCustomLabels)
      .catch(() => setCustomLabels([]));
  };

  const refreshSchemes = async () => {
    const next = await listSchemes();
    setSchemes(next);
  };

  const handleAddDir = async (dir: string): Promise<string | null> => {
    try {
      const outcome = await addWatchedDir(dir);
      // 乐观回显（mergeLocal 永不持久化）：add_watched_dir 已在后端落盘，
      // 权威列表经 settings-changed 事件回流刷新。
      mergeLocal({
        watched_dirs: [...new Set([...(settings?.watched_dirs ?? []), outcome.dir])],
      });
      setNotice(outcome.message ?? t("settings.dirAdded"));
      return null;
    } catch (err) {
      setNotice(null);
      return String(err);
    }
  };

  const handleRemoveClick = async (dir: string) => {
    try {
      const count = await countUnderRoot(dir);
      setRemoveTarget({ dir, count });
    } catch (err) {
      setDirError(String(err));
    }
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    const dir = removeTarget.dir;
    setRemoveTarget(null);
    try {
      await removeWatchedDir(dir);
      // 乐观回显（同 handleAddDir）：以后端 settings-changed 刷新为准。
      mergeLocal({
        watched_dirs: (settings?.watched_dirs ?? []).filter((d) => d !== dir),
      });
      setDirError(null);
    } catch (err) {
      setDirError(String(err));
    }
  };

  const handleRescanAll = () => {
    scan.startScanAll();
    setNotice(t("settings.scanStarted"));
  };

  const handleCopyLogDir = async () => {
    if (!logDir) return;
    try {
      await navigator.clipboard.writeText(logDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时保持静默
    }
  };

  const handleApplyScheme = async (id: string) => {
    if (!settings) return;
    const preset = RULE_PRESETS.find((p) => p.id === id);
    const scheme = schemes.find((s) => s.id === id);
    if (!preset && !scheme) return;
    const next = preset
      ? applyPreset(settings, preset)
      : { ...settings, ...cloneRules(scheme!) };
    try {
      await commit({
        ignore_rules: next.ignore_rules,
        classify_overrides: next.classify_overrides,
      });
      setNotice(t("settings.schemeApplied"));
    } catch (err) {
      setNotice(null);
      setRuleError(String(err));
    }
  };

  const handleReset = async () => {
    try {
      const reset = await resetSettings();
      syncFromBackend(reset);
      setNotice(t("settings.resetDone"));
    } catch (err) {
      setRuleError(String(err));
    }
  };

  const saveIgnoreRules = async (rules: IgnoreRules) => {
    await commit({ ignore_rules: rules });
    setNotice(t("settings.rulesSavedRestart"));
  };

  const saveMapping = async (overrides: ClassifyRule[]) => {
    await commit({ classify_overrides: overrides });
    setNotice(t("settings.rulesSavedRestart"));
  };

  const saveOpenConfig = async (draft: OpenConfig) => {
    await commit({
      preferred_ide: draft.preferredIde,
      custom_open_commands: draft.customOpenCommands,
    });
    setNotice(t("settings.openToolsSaved"));
  };

  const saveArchiveConfig = async (draft: {
    archive_root: string;
    auto_archive: boolean;
  }) => {
    await commit({
      archive_root: draft.archive_root,
      auto_archive: draft.auto_archive,
    });
    setNotice(t("settings.archiveSaved"));
  };

  const handleCreateHomeworkShortcut = async () => {
    try {
      await createHomeworkShortcut();
      setNotice(t("settings.homeworkShortcutCreated"));
    } catch (err) {
      setNotice(null);
      setRuleError(String(err));
    }
  };

  if (!settings) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold text-strong">
          {t("pages.settings.title")}
        </h1>
        <p className="mt-4 text-sm text-muted">
          {t("files.loading")}
        </p>
      </div>
    );
  }

  const ignoreSummary = summarizeIgnoreRules(settings.ignore_rules);
  const currentScheme = resolveCurrentScheme(settings, RULE_PRESETS, schemes);
  const schemeLabel =
    currentScheme.kind === "builtin"
      ? t(currentScheme.nameKey)
      : currentScheme.kind === "custom"
        ? currentScheme.name
        : t("settings.schemeUnsaved");
  const preferredIdeLabel = t(
    PREFERRED_IDE_OPTIONS.find((o) => o.value === settings.preferred_ide)
      ?.labelKey ?? "settings.preferredIdeAuto",
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t("pages.settings.title")}
        description={t("pages.settings.description")}
        actions={<PageHelpButton target="settings" />}
      />

      {scan.status?.active && (
        <Banner variant="brand" className="mt-4">
          {t("settings.scanningNow", { dir: scan.status.dir ?? "" })}
        </Banner>
      )}
      {notice && (
        <Banner variant="brand" className="mt-4">
          {notice}
        </Banner>
      )}
      {dirError && (
        <Banner variant="error" className="mt-4">
          <span className="block truncate">{dirError}</span>
        </Banner>
      )}
      {ruleError && (
        <Banner variant="error" className="mt-4">
          <span className="block truncate">{ruleError}</span>
        </Banner>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <FormSection
          title={t("settings.settingsGroupGeneral")}
          description={t("settingsGuide.groups.general.description")}
          indentContent
        >
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <span className="block text-sm font-medium text-strong">
                {t("settings.theme")}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {THEME_OPTIONS.map(({ value, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    className={`rounded-md px-4 py-2 text-sm transition-colors ${
                      theme === value
                        ? "bg-brand-700 font-medium text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <label
                htmlFor="settings-language"
                className="block text-sm font-medium text-strong"
              >
                {t("settings.language")}
              </label>
              <Select
                id="settings-language"
                value={language}
                onChange={(next) => update({ language: next as Language })}
                options={LANGUAGE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                  icon:
                    option.value === "zh-CN" ? (
                      <Languages aria-hidden className="size-3.5" />
                    ) : (
                      <Globe aria-hidden className="size-3.5" />
                    ),
                }))}
                searchable={false}
                className="mt-2 w-44"
              />
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <label
                htmlFor="settings-close-action"
                className="block text-sm font-medium text-strong"
              >
                {t("settings.closeAction")}
              </label>
              <Select
                id="settings-close-action"
                value={settings.close_action}
                onChange={(next) => update({ close_action: next as CloseAction })}
                options={CLOSE_ACTION_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                  icon: <option.icon aria-hidden className="size-3.5" />,
                }))}
                searchable={false}
                className="mt-2 w-44"
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title={t("settings.settingsGroupWatch")}
          description={t("settingsGuide.groups.watch.description")}
          indentContent
        >
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-secondary">
                  {t("settings.watchedDirs")}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  onClick={handleRescanAll}
                >
                  {t("settings.rescanAll")}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted">
                {t("settings.watchedDirsDesc")}
              </p>
              <DirectoryAdder
                placeholder={t("settings.dirPlaceholder")}
                hint={t("settings.dragDropHint")}
                addLabel={t("settings.addDir")}
                browseLabel={t("settings.browse")}
                commonDirs={commonDirs}
                onAdd={handleAddDir}
              />
              <ul className="mt-2.5 space-y-1">
                {watchedDirs.length === 0 ? (
                  <li className="text-xs text-slate-400 dark:text-slate-500">
                    {t("settings.dirEmpty")}
                  </li>
                ) : (
                  watchedDirs.map((dir) => (
                    <li
                      key={dir}
                      className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800"
                    >
                      <span
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate"
                        title={missingDirs.has(dir) ? t("settings.dirMissing") : dir}
                      >
                        {missingDirs.has(dir) && (
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-amber-500"
                          />
                        )}
                        <span className="min-w-0 truncate">{dir}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRemoveClick(dir)}
                        className="shrink-0 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-500"
                      >
                        {t("settings.remove")}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-secondary">
                    {t("settings.schemeRow")}
                  </span>
                  <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                    {schemeLabel}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-muted">
                  {t("settings.schemeSummary", {
                    ignore: ignoreSummary.total,
                    override: settings.classify_overrides.length,
                  })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setApplyMenuOpen(true)}
                >
                  {t("settings.applyScheme")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setSchemeOpen(true)}
                >
                  {t("settings.saveAsScheme")}
                </Button>
              </div>
            </div>
            <Row
              title={t("settings.ignoreRow")}
              summary={t("settings.ignoreRowSummary", {
                total: ignoreSummary.total,
                extensions: ignoreSummary.extensions,
                prefixes: ignoreSummary.prefixes,
                names: ignoreSummary.exactNames,
              })}
              guideId="ignoreRules"
              onInfo={(id) =>
                setInfoEntry(SETTINGS_GUIDE.find((item) => item.id === id) ?? null)
              }
              onEdit={() => setIgnoreOpen(true)}
            />
            <Row
              title={t("settings.mappingRow")}
              summary={t("settings.mappingRowSummary", {
                builtin: defaults.length,
                overrides: settings.classify_overrides.length,
              })}
              guideId="classifyMapping"
              onInfo={(id) =>
                setInfoEntry(SETTINGS_GUIDE.find((item) => item.id === id) ?? null)
              }
              onEdit={() => setMappingOpen(true)}
            />
            <Row
              title={t("settings.labelRow")}
              summary={t("settings.labelRowSummary", {
                builtin: categories.length,
                custom: customLabels.length,
              })}
              guideId="labels"
              onInfo={(id) =>
                setInfoEntry(SETTINGS_GUIDE.find((item) => item.id === id) ?? null)
              }
              onEdit={() => setLabelOpen(true)}
            />
          </div>
        </FormSection>

        <FormSection
          title={t("settings.settingsGroupArchive")}
          description={t("settingsGuide.groups.archive.description")}
          indentContent
        >
          <Row
            title={t("settings.archiveRow")}
            summary={
              settings.archive_root.trim() ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <RevealLink
                    label={t("files.archiveDestLabel")}
                    path={settings.archive_root.trim()}
                  />
                  <span className="text-xs text-muted">
                    ·{" "}
                    {t("settings.archiveRowAuto", {
                      auto: settings.auto_archive
                        ? t("settings.archiveAutoOn")
                        : t("settings.archiveAutoOff"),
                    })}
                  </span>
                </span>
              ) : (
                t("settings.archiveRootNone")
              )
            }
            guideId="archive"
            onInfo={(id) =>
              setInfoEntry(SETTINGS_GUIDE.find((item) => item.id === id) ?? null)
            }
            onEdit={() => setArchiveOpen(true)}
          />
        </FormSection>

        <FormSection
          title={t("settings.settingsGroupReminder")}
          description={t("settingsGuide.groups.reminder.description")}
          indentContent
        >
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-strong">
                    {t("settings.reminderEnabled")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t("settings.reminderLeadDaysHint")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                      settings.reminder_enabled
                        ? "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                        : "bg-slate-200/70 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {t(
                      settings.reminder_enabled
                        ? "settings.stateOn"
                        : "settings.stateOff",
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.reminder_enabled}
                    onChange={(event) =>
                      update({ reminder_enabled: event.target.checked })
                    }
                    aria-label={t("settings.reminderEnabled")}
                    className="size-4 accent-brand-600"
                  />
                </div>
              </div>
              <div
                className={`mt-3 border-t border-slate-100 pt-3 dark:border-slate-800 ${
                  settings.reminder_enabled ? "" : "opacity-50"
                }`}
              >
                <label
                  htmlFor="settings-reminder-lead"
                  className="block text-xs font-medium text-secondary"
                >
                  {t("settings.reminderLeadDays")}
                </label>
                <Select
                  id="settings-reminder-lead"
                  value={String(settings.reminder_lead_days)}
                  onChange={(next) =>
                    update({ reminder_lead_days: Number(next) })
                  }
                  options={REMINDER_LEAD_OPTIONS.map((days) => ({
                    value: String(days),
                    label: String(days),
                  }))}
                  searchable={false}
                  disabled={!settings.reminder_enabled}
                  className="mt-1.5 w-44"
                />
                <p className="mt-1 text-xs text-muted">
                  {t(
                    settings.reminder_enabled
                      ? "settings.reminderLeadDaysHint"
                      : "settings.reminderLeadDaysDisabled",
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <div className="min-w-0">
                <div className="text-sm font-medium text-strong">
                  {t("settings.homeworkShortcut")}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {t("settingsGuide.homeworkShortcut.tips")}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={Check}
                onClick={() => void handleCreateHomeworkShortcut()}
              >
                {t("settings.homeworkShortcutCreate")}
              </Button>
            </div>
          </div>
        </FormSection>

        <FormSection
          title={t("settings.settingsGroupAdvanced")}
          description={t("settingsGuide.groups.advanced.description")}
          indentContent
        >
          <div className="space-y-3">
            <Row
              title={t("settings.projectOpenRow")}
              summary={t("settings.projectOpenSummary", {
                ide: preferredIdeLabel,
                custom: settings.custom_open_commands.length,
              })}
              guideId="projectOpen"
              onInfo={(id) =>
                setInfoEntry(SETTINGS_GUIDE.find((item) => item.id === id) ?? null)
              }
              onEdit={() => setProjectOpenOpen(true)}
            />
            <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <div className="text-sm font-semibold text-secondary">
                {t("settings.logDir")}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {t("settings.logDirHint")}
              </p>
              {logDir && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-white px-3 py-2 dark:bg-slate-900">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                    {logDir}
                  </span>
                  <IconButton
                    label={t("settings.copyPath")}
                    icon={copied ? Check : Copy}
                    tone="brand"
                    size="md"
                    onClick={() => void handleCopyLogDir()}
                    className={copied ? "text-brand-600" : ""}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/50 px-4 py-3 dark:border-red-500/25 dark:bg-red-500/10">
              <div>
                <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {t("settings.resetSettings")}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {t("settings.resetHint")}
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                icon={RotateCcw}
                onClick={() => setResetOpen(true)}
              >
                {t("settings.resetSettings")}
              </Button>
            </div>
          </div>
        </FormSection>
      </div>

      <SettingsInfoDialog
        open={infoEntry !== null}
        entry={infoEntry}
        onClose={() => setInfoEntry(null)}
      />
      <IgnoreRulesDialog
        open={ignoreOpen}
        initial={settings.ignore_rules}
        onSave={saveIgnoreRules}
        onClose={() => setIgnoreOpen(false)}
      />
      <ClassifyMappingDialog
        open={mappingOpen}
        defaults={defaults}
        categories={categories}
        initial={settings.classify_overrides}
        onSave={saveMapping}
        onClose={() => setMappingOpen(false)}
      />
      <LabelManageDialog
        open={labelOpen}
        categories={categories}
        labels={customLabels}
        onChanged={refreshLabels}
        onClose={() => {
          setLabelOpen(false);
          refreshLabels();
        }}
      />
      <SchemeDialog
        open={schemeOpen}
        schemes={schemes}
        current={cloneRules(settings)}
        onChanged={refreshSchemes}
        onClose={() => setSchemeOpen(false)}
      />
      <SchemeApplyDialog
        open={applyMenuOpen}
        schemes={schemes}
        current={currentScheme}
        onApply={(id) => void handleApplyScheme(id)}
        onClose={() => setApplyMenuOpen(false)}
      />
      <ConfirmDialog
        open={resetOpen}
        title={t("settings.resetSettings")}
        description={t("settings.resetConfirm")}
        confirmLabel={t("settings.resetSettings")}
        danger
        onConfirm={() => {
          setResetOpen(false);
          void handleReset();
        }}
        onCancel={() => setResetOpen(false)}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        title={t("settings.removeDir")}
        description={t("settings.removeCleanupConfirm", {
          count: removeTarget?.count ?? 0,
        })}
        confirmLabel={t("settings.remove")}
        danger
        onConfirm={() => void handleRemoveConfirm()}
        onCancel={() => setRemoveTarget(null)}
      >
        {removeTarget && (
          <Tooltip content={removeTarget.dir} className="mt-2 block">
            <span className="block cursor-default truncate rounded-md bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-secondary dark:bg-slate-800">
              {removeTarget.dir}
            </span>
          </Tooltip>
        )}
      </ConfirmDialog>
      <ProjectOpenDialog
        open={projectOpenOpen}
        initial={{
          preferredIde: settings.preferred_ide,
          customOpenCommands: settings.custom_open_commands,
        }}
        onSave={saveOpenConfig}
        onClose={() => setProjectOpenOpen(false)}
      />
      <ArchiveSettingsDialog
        open={archiveOpen}
        root={settings.archive_root}
        autoArchive={settings.auto_archive}
        onSave={saveArchiveConfig}
        onClose={() => setArchiveOpen(false)}
      />
    </div>
  );
}
