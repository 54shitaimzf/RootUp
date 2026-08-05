import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Check, Copy, FolderOpen, RefreshCw, RotateCcw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  listWatchedDirs,
  listCommonDirs,
  openDirectoryDialog,
  removeWatchedDir,
  resolveDirTarget,
  resetSettings,
  type ClassifyDefaultEntry,
  type ClassifyRule,
  type CloseAction,
  type CommonDirEntry,
  type IgnoreRules,
  type LabelDef,
  type Language,
  type RuleScheme,
  type Settings,
  type ThemeMode,
} from "../lib/tauri";
import { cleanPathInput } from "../lib/paths";
import { SETTINGS_GUIDE, type SettingsGuideEntry } from "../lib/settingsGuide";
import {
  resolveCurrentScheme,
  summarizeIgnoreRules,
} from "../lib/effectiveMap";
import { PREFERRED_IDE_OPTIONS } from "../lib/projects";
import { useTheme } from "../theme/ThemeProvider";
import { FormSection } from "../components/FormSection";
import { Select } from "../components/Select";
import { SettingsInfoDialog } from "../components/SettingsInfoDialog";
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
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

const CLOSE_ACTION_OPTIONS: { value: CloseAction; labelKey: string }[] = [
  { value: "ask", labelKey: "settings.closeActionAsk" },
  { value: "background", labelKey: "settings.closeActionBackground" },
  { value: "quit", labelKey: "settings.closeActionQuit" },
];

const REMINDER_LEAD_OPTIONS = [1, 2, 3, 5, 7, 14];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

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
  summary: string;
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
  const { settings, update, replace } = useSettings();
  const language = settings?.language ?? "zh-CN";
  const [watchedDirs, setWatchedDirs] = useState<string[]>([]);
  const [newDir, setNewDir] = useState("");
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
  const [dragActive, setDragActive] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    dir: string;
    count: number;
  } | null>(null);
  const [infoEntry, setInfoEntry] = useState<SettingsGuideEntry | null>(null);

  useEffect(() => {
    listWatchedDirs()
      .then(setWatchedDirs)
      .catch(() => setWatchedDirs([]));
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

  // 文件夹拖拽：目录直接添加，文件取其父目录。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "over") {
            setDragActive(true);
          } else if (event.payload.type === "leave") {
            setDragActive(false);
          } else if (event.payload.type === "drop") {
            setDragActive(false);
            const first = event.payload.paths[0];
            if (first) {
              void submitDir(first, true);
            }
          }
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // 非 Tauri 环境（测试/浏览器预览）下拖拽不可用，静默跳过
    }
    return () => {
      unlisten?.();
    };
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

  const handleAddDir = async () => {
    const dir = cleanPathInput(newDir);
    if (!dir) return;
    await submitDir(dir, false);
  };

  const submitDir = async (value: string, allowFileParent: boolean) => {
    let dir = cleanPathInput(value);
    if (!dir) return;
    try {
      if (allowFileParent) {
        dir = await resolveDirTarget(dir);
      }
      const outcome = await addWatchedDir(dir);
      setWatchedDirs((prev) => [...new Set([...prev, outcome.dir])]);
      setNewDir("");
      setDirError(null);
      setNotice(outcome.message ?? t("settings.dirAdded"));
    } catch (err) {
      setDirError(String(err));
      setNotice(null);
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
      setWatchedDirs((prev) => prev.filter((d) => d !== dir));
      setDirError(null);
    } catch (err) {
      setDirError(String(err));
    }
  };

  const handleBrowse = async () => {
    try {
      const dir = await openDirectoryDialog();
      if (dir) await submitDir(dir, false);
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
    let next: Settings;
    if (preset) {
      next = applyPreset(settings, preset);
    } else {
      next = {
        ...settings,
        ...cloneRules(scheme!),
      };
    }
    try {
      await replace(next);
      setNotice(t("settings.schemeApplied"));
    } catch (err) {
      setNotice(null);
      setRuleError(String(err));
    }
  };

  const handleReset = async () => {
    try {
      const reset = await resetSettings();
      await replace(reset);
      setNotice(t("settings.resetDone"));
    } catch (err) {
      setRuleError(String(err));
    }
  };

  const saveIgnoreRules = async (rules: IgnoreRules) => {
    if (!settings) return;
    await replace({ ...settings, ignore_rules: rules });
    setNotice(t("settings.rulesSavedRestart"));
  };

  const saveMapping = async (overrides: ClassifyRule[]) => {
    if (!settings) return;
    await replace({ ...settings, classify_overrides: overrides });
    setNotice(t("settings.rulesSavedRestart"));
  };

  const saveOpenConfig = async (draft: OpenConfig) => {
    if (!settings) return;
    await replace({
      ...settings,
      preferred_ide: draft.preferredIde,
      custom_open_commands: draft.customOpenCommands,
    });
    setNotice(t("settings.openToolsSaved"));
  };

  const saveArchiveConfig = async (draft: {
    archive_root: string;
    auto_archive: boolean;
  }) => {
    if (!settings) return;
    await replace({ ...settings, ...draft });
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

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <FormSection
          title={t("settings.settingsGroupGeneral")}
          description={t("settingsGuide.groups.general.description")}
        >
          <div className="space-y-5">
            <div>
              <span className="text-xs font-medium text-secondary">
                {t("settings.theme")}
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
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
            <div>
              <label
                htmlFor="settings-language"
                className="text-xs font-medium text-secondary"
              >
                {t("settings.language")}
              </label>
              <Select
                id="settings-language"
                value={language}
                onChange={(event) =>
                  update({ language: event.target.value as Language })
                }
                className="mt-1.5 w-44"
              >
                {LANGUAGE_OPTIONS.map(({ value, labelKey }) => (
                  <option key={value} value={value}>
                    {t(labelKey)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label
                htmlFor="settings-close-action"
                className="text-xs font-medium text-secondary"
              >
                {t("settings.closeAction")}
              </label>
              <Select
                id="settings-close-action"
                value={settings.close_action}
                onChange={(event) =>
                  update({ close_action: event.target.value as CloseAction })
                }
                className="mt-1.5 w-44"
              >
                {CLOSE_ACTION_OPTIONS.map(({ value, labelKey }) => (
                  <option key={value} value={value}>
                    {t(labelKey)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </FormSection>

        <FormSection
          title={t("settings.settingsGroupWatch")}
          description={t("settingsGuide.groups.watch.description")}
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
              <div
                className={`mt-2.5 rounded-lg border border-dashed px-3 py-2.5 transition-colors ${
                  dragActive
                    ? "border-brand-400 bg-brand-50/70 dark:border-brand-500/50 dark:bg-brand-500/10"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newDir}
                    onChange={(event) => setNewDir(event.target.value)}
                    onKeyDown={(event) => {
                      if (isComposing(event)) return;
                      if (event.key === "Enter") void handleAddDir();
                    }}
                    placeholder={t("settings.dirPlaceholder")}
                    className="flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    icon={FolderOpen}
                    onClick={() => void handleBrowse()}
                  >
                    {t("settings.browse")}
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => void handleAddDir()}
                  >
                    {t("settings.addDir")}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {t("settings.dragDropHint")}
                </p>
                {commonDirs.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">
                      {t("settings.commonDirs")}
                    </span>
                    {commonDirs.map((entry) => (
                      <button
                        key={entry.kind}
                        type="button"
                        onClick={() => void submitDir(entry.path, false)}
                        className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300"
                      >
                        {t(`settings.commonDir${capitalize(entry.kind)}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                      <span className="min-w-0 flex-1 truncate">{dir}</span>
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
        >
          <Row
            title={t("settings.archiveRow")}
            summary={t("settings.archiveRowSummary", {
              root: settings.archive_root.trim() || t("settings.archiveRootNone"),
              auto: settings.auto_archive
                ? t("settings.archiveAutoOn")
                : t("settings.archiveAutoOff"),
            })}
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
        >
          <div className="space-y-5">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-secondary">
                {t("settings.reminderEnabled")}
              </span>
              <input
                type="checkbox"
                checked={settings.reminder_enabled}
                onChange={(event) =>
                  update({ reminder_enabled: event.target.checked })
                }
                className="size-4 accent-brand-600"
              />
            </label>
            <div>
              <label
                htmlFor="settings-reminder-lead"
                className="text-xs font-medium text-secondary"
              >
                {t("settings.reminderLeadDays")}
              </label>
              <Select
                id="settings-reminder-lead"
                value={String(settings.reminder_lead_days)}
                onChange={(event) =>
                  update({ reminder_lead_days: Number(event.target.value) })
                }
                className="mt-1.5 w-44"
              >
                {REMINDER_LEAD_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">
                {t("settings.reminderLeadDaysHint")}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <div className="min-w-0 text-sm font-semibold text-secondary">
                {t("settings.homeworkShortcut")}
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
          dir: removeTarget?.dir ?? "",
          count: removeTarget?.count ?? 0,
        })}
        confirmLabel={t("settings.remove")}
        danger
        onConfirm={() => void handleRemoveConfirm()}
        onCancel={() => setRemoveTarget(null)}
      />
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
