import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Search } from "lucide-react";
import {
  buildEffectiveMap,
  resetExtensionCategory,
  setExtensionCategory,
} from "../../../lib/effectiveMap";
import type { ClassifyDefaultEntry, ClassifyRule } from "../../../lib/tauri";
import { Button } from "../../../components/Button";
import { Chip } from "../../../components/Chip";
import { FilterIcon } from "../../../components/FilterIcon";
import { InlineNotice } from "../../../components/InlineNotice";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { Select } from "../../../components/Select";

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
      contentHeight="h-[65vh]"
      brandTitle
      footer={
        <>
          <Button variant="primary" size="md" onClick={() => void save()}>
            {t("settings.save")}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            size="sm"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.mappingSearch")}
            className="w-full pl-8 pr-3"
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
        <InlineNotice variant="error" className="mt-3">
          {error}
        </InlineNotice>
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
                  className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors"
                >
                  <span className="text-xs font-semibold text-secondary transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-300">
                    {t(`filter.${category}`)}
                    <span className="ml-2 font-normal text-muted">
                      {t("settings.mappingGroupCount", { count: entries.length })}
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-3.5 text-slate-400 transition-transform group-hover:text-slate-600 dark:group-hover:text-slate-300 ${
                      isCollapsed ? "" : "rotate-180"
                    }`}
                  />
                </button>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-0.5">
                    {entries.map((ext) => {
                      const isOverridden = effective.overridden.has(ext);
                      return (
                        <Chip
                          key={ext}
                          size="md"
                          variant="selectable"
                          onClick={(event) => openEditor(ext, event)}
                          badge={
                            isOverridden ? (
                              <span className="rounded bg-brand-600/10 px-1 py-px text-[10px] font-medium text-brand-600 dark:bg-brand-400/15 dark:text-brand-300">
                                {t("settings.mappingCustom")}
                              </span>
                            ) : undefined
                          }
                        >
                          {ext}
                        </Chip>
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
            className="floating-panel pop-in fixed z-50 w-72 p-4"
            style={{ top: editing.anchor.top, left: editing.anchor.left }}
          >
            <div className="text-xs font-semibold text-secondary">
              .{editing.ext}
            </div>
            <Select
              value={editing.category}
              onChange={(next) =>
                setEditing((prev) =>
                  prev ? { ...prev, category: next } : prev,
                )
              }
              options={categories.map((category) => ({
                value: category,
                label: t(`filter.${category}`),
                icon: <FilterIcon kind="category" value={category} />,
              }))}
              className="mt-2"
            />
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
                <Button variant="primary" size="sm" onClick={applyEdit}>
                  {t("settings.save")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  {t("settings.cancel")}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-muted dark:border-slate-800">
        {t("settings.restartHint")}
      </p>
    </Modal>
  );
}
