import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, RotateCcw, X } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import type { ScanController } from "../hooks/useScan";
import { applyPreset, RULE_PRESETS } from "../lib/presets";
import {
  addWatchedDir,
  getLogDir,
  listCategories,
  listClassifyDefaults,
  listWatchedDirs,
  removeWatchedDir,
  resetSettings,
  type ClassifyDefaultEntry,
  type ClassifyRule,
  type IgnoreRules,
  type Language,
  type Settings,
  type ThemeMode,
} from "../lib/tauri";
import { useTheme } from "../theme/ThemeProvider";

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

const LANGUAGE_OPTIONS: { value: Language; labelKey: string }[] = [
  { value: "zh-CN", labelKey: "settings.languageZh" },
  { value: "en", labelKey: "settings.languageEn" },
];

function ChipGroup({
  items,
  onAdd,
  onRemove,
  placeholder,
  addLabel,
}: {
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder: string;
  addLabel: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };
  return (
    <div>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
        ) : (
          items.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={t("settings.remove")}
                className="rounded p-0.5 text-slate-400 hover:text-red-500 dark:text-slate-500"
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
        />
        <button
          type="button"
          onClick={submit}
          className="shrink-0 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {addLabel}
        </button>
      </div>
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
  const [notice, setNotice] = useState<string | null>(null);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 规则区块
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRules>({
    extensions: [],
    prefixes: [],
    exact_names: [],
  });
  const [classifyOverrides, setClassifyOverrides] = useState<ClassifyRule[]>([]);
  const [defaults, setDefaults] = useState<ClassifyDefaultEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [presetId, setPresetId] = useState("default");
  const [newMapExts, setNewMapExts] = useState("");
  const [newMapCategory, setNewMapCategory] = useState("document");
  const [ruleError, setRuleError] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    if (settings) {
      setIgnoreRules(settings.ignore_rules);
      setClassifyOverrides(settings.classify_overrides);
    }
  }, [settings]);

  const handleAddDir = async () => {
    const dir = newDir.trim();
    if (!dir) return;
    try {
      const outcome = await addWatchedDir(dir);
      setWatchedDirs((prev) => [...new Set([...prev, dir])]);
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

  // 忽略规则编辑
  const addExtension = (value: string) => {
    const ext = value.trim().toLowerCase().replace(/\./g, "");
    if (!ext) return;
    if (ignoreRules.extensions.includes(ext)) {
      setRuleError(t("settings.ruleDuplicate"));
      return;
    }
    setIgnoreRules((prev) => ({ ...prev, extensions: [...prev.extensions, ext] }));
    setRuleError(null);
  };
  const addPrefix = (value: string) => {
    if (ignoreRules.prefixes.includes(value)) {
      setRuleError(t("settings.ruleDuplicate"));
      return;
    }
    setIgnoreRules((prev) => ({ ...prev, prefixes: [...prev.prefixes, value] }));
    setRuleError(null);
  };
  const addExact = (value: string) => {
    if (ignoreRules.exact_names.includes(value)) {
      setRuleError(t("settings.ruleDuplicate"));
      return;
    }
    setIgnoreRules((prev) => ({ ...prev, exact_names: [...prev.exact_names, value] }));
    setRuleError(null);
  };

  // 分类覆盖编辑
  const addMapping = () => {
    const exts = newMapExts
      .split(",")
      .map((e) => e.trim().toLowerCase().replace(/\./g, ""))
      .filter(Boolean);
    if (exts.length === 0 || !newMapCategory) return;
    setClassifyOverrides((prev) => [
      ...prev,
      { extensions: exts, category: newMapCategory },
    ]);
    setNewMapExts("");
    setRuleError(null);
  };
  const removeMapping = (index: number) => {
    setClassifyOverrides((prev) => prev.filter((_, i) => i !== index));
  };

  // 保存规则（重启生效）
  const saveRules = async () => {
    if (!settings) return;
    const next: Settings = {
      ...settings,
      ignore_rules: ignoreRules,
      classify_overrides: classifyOverrides,
    };
    try {
      await replace(next);
      setRuleError(null);
      setNotice(t("settings.rulesSavedRestart"));
    } catch (err) {
      setRuleError(String(err));
      setNotice(null);
    }
  };

  const handleApplyPreset = () => {
    const preset = RULE_PRESETS.find((p) => p.id === presetId);
    if (!preset || !settings) return;
    if (!window.confirm(t("settings.presetConfirm"))) return;
    const next = applyPreset(settings, preset);
    setIgnoreRules(next.ignore_rules);
    setClassifyOverrides(next.classify_overrides);
    setNotice(t("settings.presetApplied"));
  };

  const handleReset = async () => {
    if (!window.confirm(t("settings.resetConfirm"))) return;
    try {
      const reset = await resetSettings();
      await replace(reset);
      setNotice(t("settings.resetDone"));
    } catch (err) {
      setRuleError(String(err));
    }
  };

  // 内置映射按类别分组
  const defaultsByCategory = categories.map((category) => ({
    category,
    extensions: defaults
      .filter((entry) => entry.category === category)
      .map((entry) => entry.extension),
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("pages.settings.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t("pages.settings.description")}
      </p>

      {scan.status?.active && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
          {t("settings.scanningNow", { dir: scan.status.dir ?? "" })}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
          {notice}
        </div>
      )}
      {ruleError && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-400">
          {ruleError}
        </div>
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("settings.watchedDirs")}</h2>
          <button
            type="button"
            onClick={handleRescanAll}
            className="flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <RefreshCw className="size-3.5" />
            {t("settings.rescanAll")}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("settings.watchedDirsDesc")}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newDir}
            onChange={(event) => setNewDir(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAddDir();
            }}
            placeholder={t("settings.dirPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={() => void handleAddDir()}
            className="shrink-0 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-800"
          >
            {t("settings.addDir")}
          </button>
        </div>
        {dirError && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400">
            {dirError}
          </p>
        )}
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("settings.ignoreAndClassify")}</h2>
          <div className="flex items-center gap-2">
            <select
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            >
              {RULE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t(preset.nameKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleApplyPreset}
              className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {t("settings.applyPreset")}
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("settings.rulesDesc")}
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("settings.ignoreExtensions")}
            </div>
            <div className="mt-1.5">
              <ChipGroup
                items={ignoreRules.extensions}
                onAdd={addExtension}
                onRemove={(value) =>
                  setIgnoreRules((prev) => ({
                    ...prev,
                    extensions: prev.extensions.filter((e) => e !== value),
                  }))
                }
                placeholder={t("settings.ignoreExtPlaceholder")}
                addLabel={t("settings.addIgnore")}
              />
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("settings.ignorePrefixes")}
            </div>
            <div className="mt-1.5">
              <ChipGroup
                items={ignoreRules.prefixes}
                onAdd={addPrefix}
                onRemove={(value) =>
                  setIgnoreRules((prev) => ({
                    ...prev,
                    prefixes: prev.prefixes.filter((p) => p !== value),
                  }))
                }
                placeholder={t("settings.ignorePrefixPlaceholder")}
                addLabel={t("settings.addIgnore")}
              />
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {t("settings.ignoreExactNames")}
            </div>
            <div className="mt-1.5">
              <ChipGroup
                items={ignoreRules.exact_names}
                onAdd={addExact}
                onRemove={(value) =>
                  setIgnoreRules((prev) => ({
                    ...prev,
                    exact_names: prev.exact_names.filter((n) => n !== value),
                  }))
                }
                placeholder={t("settings.ignoreExactPlaceholder")}
                addLabel={t("settings.addIgnore")}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("settings.classifyMapping")}
          </div>
          <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            {t("settings.classifyDefaults")}
          </div>
          <div className="mt-1.5 space-y-1">
            {defaultsByCategory.map(({ category, extensions }) => (
              <div key={category} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-16 shrink-0 font-medium text-slate-500 dark:text-slate-400">
                  {t(`filter.${category}`)}
                </span>
                <span className="min-w-0 flex-1 text-slate-400 dark:text-slate-500">
                  {extensions.length > 0 ? extensions.join(" · ") : "—"}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("settings.classifyOverrides")}
          </div>
          <div className="mt-1.5 space-y-1">
            {classifyOverrides.length === 0 ? (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {t("settings.overridesEmpty")}
              </span>
            ) : (
              classifyOverrides.map((rule, index) => (
                <div
                  key={`${rule.category}-${index}`}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {rule.extensions.join(", ")}
                  </span>
                  <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    {t(`filter.${rule.category}`, rule.category)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMapping(index)}
                    aria-label={t("settings.remove")}
                    className="shrink-0 text-slate-400 hover:text-red-500 dark:text-slate-500"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={newMapExts}
              onChange={(event) => setNewMapExts(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addMapping();
              }}
              placeholder={t("settings.classifyExtPlaceholder")}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <select
              value={newMapCategory}
              onChange={(event) => setNewMapCategory(event.target.value)}
              className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {t(`filter.${category}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addMapping}
              className="shrink-0 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {t("settings.addMapping")}
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {t("settings.restartHint")}
          </span>
          <button
            type="button"
            onClick={() => void saveRules()}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-800"
          >
            {t("settings.saveRules")}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-medium">{t("settings.theme")}</h2>
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
        <h2 className="text-sm font-medium">{t("settings.language")}</h2>
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
        <h2 className="text-sm font-medium">{t("settings.logDir")}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("settings.logDirHint")}
        </p>
        {logDir && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">
              {logDir}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyLogDir()}
              aria-label={t("settings.copyPath")}
              className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
            >
              {copied ? (
                <Check className="size-4 text-brand-600" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-red-200 bg-white p-5 shadow-card dark:border-red-500/25 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-red-600 dark:text-red-400">
              {t("settings.resetSettings")}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t("settings.resetHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleReset()}
            className="flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <RotateCcw className="size-3.5" />
            {t("settings.resetSettings")}
          </button>
        </div>
      </section>
    </div>
  );
}
