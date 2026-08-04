import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import type { ScanController } from "../hooks/useScan";
import { applyPreset, RULE_PRESETS } from "../lib/presets";
import {
  addWatchedDir,
  getLogDir,
  listCategories,
  listClassifyDefaults,
  listLabelDefs,
  listSchemes,
  listWatchedDirs,
  removeWatchedDir,
  resetSettings,
  type ClassifyDefaultEntry,
  type ClassifyRule,
  type IgnoreRules,
  type LabelDef,
  type Language,
  type RuleScheme,
  type Settings,
  type ThemeMode,
} from "../lib/tauri";
import {
  resolveCurrentScheme,
  summarizeIgnoreRules,
} from "../lib/effectiveMap";
import { PREFERRED_IDE_OPTIONS } from "../lib/projects";
import { useTheme } from "../theme/ThemeProvider";
import { IgnoreRulesDialog } from "../features/settings/IgnoreRulesDialog";
import { ClassifyMappingDialog } from "../features/settings/ClassifyMappingDialog";
import { LabelManageDialog } from "../features/settings/LabelManageDialog";
import { SchemeDialog } from "../features/settings/SchemeDialog";
import { SchemeApplyDialog } from "../features/settings/SchemeApplyDialog";
import {
  ProjectOpenDialog,
  type OpenConfig,
} from "../features/settings/ProjectOpenDialog";
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

const LANGUAGE_OPTIONS: { value: Language; labelKey: string }[] = [
  { value: "zh-CN", labelKey: "settings.languageZh" },
  { value: "en", labelKey: "settings.languageEn" },
];

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
  onClick,
}: {
  title: string;
  summary: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/70"
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
          onClick();
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
  const [customLabels, setCustomLabels] = useState<LabelDef[]>([]);

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
    const dir = newDir.trim();
    if (!dir) return;
    try {
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

  const handleRemoveDir = async (dir: string) => {
    try {
      await removeWatchedDir(dir);
      setWatchedDirs((prev) => prev.filter((d) => d !== dir));
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

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-secondary">
            {t("settings.watchedDirs")}
          </h2>
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
        <div className="mt-3 flex gap-2">
          <Input
            type="text"
            value={newDir}
            onChange={(event) => setNewDir(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAddDir();
            }}
            placeholder={t("settings.dirPlaceholder")}
            className="flex-1"
          />
          <Button variant="primary" size="md" onClick={() => void handleAddDir()}>
            {t("settings.addDir")}
          </Button>
        </div>
        <ul className="mt-3 space-y-1">
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
                  onClick={() => void handleRemoveDir(dir)}
                  className="shrink-0 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-500"
                >
                  {t("settings.remove")}
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-secondary">
          {t("settings.rulesSection")}
        </h2>
        <div className="mt-3 space-y-2">
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
                onClick={() => {
                  setSchemeOpen(true);
                }}
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
            onClick={() => setIgnoreOpen(true)}
          />
          <Row
            title={t("settings.mappingRow")}
            summary={t("settings.mappingRowSummary", {
              builtin: defaults.length,
              overrides: settings.classify_overrides.length,
            })}
            onClick={() => setMappingOpen(true)}
          />
          <Row
            title={t("settings.labelRow")}
            summary={t("settings.labelRowSummary", {
              builtin: categories.length,
              custom: customLabels.length,
            })}
            onClick={() => setLabelOpen(true)}
          />
          <Row
            title={t("settings.projectOpenRow")}
            summary={t("settings.projectOpenSummary", {
              ide: preferredIdeLabel,
              custom: settings.custom_open_commands.length,
            })}
            onClick={() => setProjectOpenOpen(true)}
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-secondary">
          {t("settings.theme")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
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
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-secondary">
          {t("settings.language")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => update({ language: value })}
              className={`rounded-md px-4 py-2 text-sm transition-colors ${
                language === value
                  ? "bg-brand-700 font-medium text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-secondary">
          {t("settings.logDir")}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {t("settings.logDirHint")}
        </p>
        {logDir && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800">
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
      </section>

      <section className="mt-4 rounded-xl border border-red-200 bg-white p-5 shadow-card dark:border-red-500/25 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">
              {t("settings.resetSettings")}
            </h2>
            <p className="mt-1 text-xs text-muted">
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
      </section>

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
      <ProjectOpenDialog
        open={projectOpenOpen}
        initial={{
          preferredIde: settings.preferred_ide,
          customOpenCommands: settings.custom_open_commands,
        }}
        onSave={saveOpenConfig}
        onClose={() => setProjectOpenOpen(false)}
      />
    </div>
  );
}
