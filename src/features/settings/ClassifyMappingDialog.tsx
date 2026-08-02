import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Search } from "lucide-react";
import {
  buildEffectiveMap,
  resetExtensionCategory,
  setExtensionCategory,
} from "../../lib/effectiveMap";
import type { ClassifyDefaultEntry, ClassifyRule } from "../../lib/tauri";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";

interface EditorAnchor {
  top: number;
  left: number;
}

/**
 * 分类映射弹窗：合并生效视图（内置 + 覆盖），按类别分组折叠；
 * 点击扩展名 chip 立即编辑，覆盖项带“自定义”角标。
 */
export function ClassifyMappingDialog({
  open,
  defaults,
  categories,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  defaults: ClassifyDefaultEntry[];
  categories: string[];
  initial: ClassifyRule[];
  onSave: (overrides: ClassifyRule[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ClassifyRule[]>(initial);
  const [query, setQuery] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{
    ext: string;
    category: string;
    anchor: EditorAnchor;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setQuery("");
      setOnlyCustom(false);
      setCollapsed({});
      setEditing(null);
      setError(null);
    }
  }, [open, initial]);

  const effective = useMemo(
    () => buildEffectiveMap(defaults, draft),
    [defaults, draft],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories
      .map((category) => {
        const entries = Object.keys(effective.map)
          .filter((ext) => effective.map[ext] === category)
          .filter(
            (ext) =>
              (!q || ext.includes(q)) &&
              (!onlyCustom || effective.overridden.has(ext)),
          )
          .sort();
        return { category, entries };
      })
      .filter((group) => group.entries.length > 0);
  }, [categories, effective, query, onlyCustom]);

  const openEditor = (ext: string, event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setEditing({
      ext,
      category: effective.map[ext],
      anchor: {
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 296),
      },
    });
  };

  const applyEdit = () => {
    if (!editing) return;
    setDraft((prev) => setExtensionCategory(prev, editing.ext, editing.category));
    setEditing(null);
  };

  const restoreDefault = () => {
    if (!editing) return;
    setDraft((prev) => resetExtensionCategory(prev, editing.ext));
    setEditing(null);
  };

  const save = async () => {
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  const toggleGroup = (category: string) => {
    setCollapsed((prev) => ({ ...prev, [category]: !(prev[category] ?? true) }));
  };

  return (
    <Modal
      open={open}
      title={t("settings.mappingDialogTitle")}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={() => void save()}>
            {t("settings.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.mappingSearch")}
            className="w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyCustom((value) => !value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            onlyCustom
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          }`}
        >
          {t("settings.mappingOnlyCustom")}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          {t("settings.mappingNoMatch")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {groups.map(({ category, entries }) => {
            const isCollapsed = collapsed[category] ?? true;
            return (
              <div
                key={category}
                className="rounded-lg border border-slate-100 dark:border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(category)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t(`filter.${category}`)}
                    <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">
                      {t("settings.mappingGroupCount", { count: entries.length })}
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-3.5 text-slate-400 transition-transform ${
                      isCollapsed ? "" : "rotate-180"
                    }`}
                  />
                </button>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-0.5">
                    {entries.map((ext) => {
                      const isOverridden = effective.overridden.has(ext);
                      return (
                        <button
                          key={ext}
                          type="button"
                          onClick={(event) => openEditor(ext, event)}
                          className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300"
                        >
                          {ext}
                          {isOverridden && (
                            <span className="rounded bg-brand-600/10 px-1 py-px text-[10px] font-medium text-brand-600 dark:bg-brand-400/15 dark:text-brand-300">
                              {t("settings.mappingCustom")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditing(null)} />
          <div
            className="fixed z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-pop dark:border-slate-700 dark:bg-slate-900"
            style={{ top: editing.anchor.top, left: editing.anchor.left }}
          >
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              .{editing.ext}
            </div>
            <select
              value={editing.category}
              onChange={(event) =>
                setEditing((prev) =>
                  prev ? { ...prev, category: event.target.value } : prev,
                )
              }
              className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-800"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {t(`filter.${category}`)}
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center justify-between gap-2">
              {effective.overridden.has(editing.ext) ? (
                <button
                  type="button"
                  onClick={restoreDefault}
                  className="text-xs text-slate-500 transition-colors hover:text-red-500 dark:text-slate-400"
                >
                  {t("settings.mappingRestoreDefault")}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  {t("settings.cancel")}
                </Button>
                <Button variant="primary" size="sm" onClick={applyEdit}>
                  {t("settings.save")}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        {t("settings.restartHint")}
      </p>
    </Modal>
  );
}
