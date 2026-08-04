import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { LabelDef } from "../../lib/tauri";
import { deleteLabelDef, saveLabelDef } from "../../lib/tauri";
import {
  DEFAULT_LABEL_COLOR,
  DEFAULT_LABEL_ICON,
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  LABEL_ICONS,
  labelColorKey,
  labelIconKey,
} from "../../lib/labelDefs";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FilterIcon } from "../../components/FilterIcon";
import { IconButton } from "../../components/IconButton";
import { InlineNotice } from "../../components/InlineNotice";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { SectionLabel } from "../../components/SectionLabel";

const KEY_PATTERN = /^[a-z0-9-]+$/;

/**
 * 标签管理弹窗：内置大类只读 + 自定义标签增删改。
 * 自定义标签 = 显示名 / key（搜索语法标识，创建后不可改）/ 图标 / 预设色板。
 */
export function LabelManageDialog({
  open,
  categories,
  labels,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: string[];
  labels: LabelDef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<LabelDef[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [icon, setIcon] = useState(DEFAULT_LABEL_ICON);
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LabelDef | null>(null);

  useEffect(() => {
    if (open) {
      setItems(labels);
      setFormOpen(false);
      setEditingKey(null);
      setName("");
      setKey("");
      setIcon(DEFAULT_LABEL_ICON);
      setColor(DEFAULT_LABEL_COLOR);
      setError(null);
      setDeleteTarget(null);
    }
  }, [open, labels]);

  const resetForm = () => {
    setFormOpen(false);
    setEditingKey(null);
    setName("");
    setKey("");
    setIcon(DEFAULT_LABEL_ICON);
    setColor(DEFAULT_LABEL_COLOR);
    setError(null);
  };

  const startCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const startEdit = (def: LabelDef) => {
    setFormOpen(true);
    setEditingKey(def.key);
    setName(def.name);
    setKey(def.key);
    setIcon(def.icon);
    setColor(def.color);
    setError(null);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    // 新建且尚未手填 key 时，若名称可转小写 slug 则自动补全，减少操作。
    if (!editingKey && !key) {
      const slug = value.trim().toLowerCase().replace(/\s+/g, "-");
      if (KEY_PATTERN.test(slug) && slug.length <= 32) {
        setKey(slug);
      }
    }
  };

  const handleKeyChange = (value: string) => {
    setKey(value.toLowerCase());
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedKey = key.trim();
    if (
      !trimmedName ||
      trimmedName.length > 40 ||
      !trimmedKey ||
      trimmedKey.length > 32 ||
      !KEY_PATTERN.test(trimmedKey)
    ) {
      setError(t("settings.labelInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveLabelDef({
        key: trimmedKey,
        name: trimmedName,
        icon: labelIconKey(icon),
        color: labelColorKey(color),
      });
      setItems((prev) => [...prev.filter((d) => d.key !== saved.key), saved]);
      onChanged();
      resetForm();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLabelDef(deleteTarget.key);
      setItems((prev) => prev.filter((d) => d.key !== deleteTarget.key));
      onChanged();
      setDeleteTarget(null);
    } catch (err) {
      setError(String(err));
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={t("settings.labelDialogTitle")}
        onClose={onClose}
        width="max-w-lg"
        footer={
          formOpen ? (
            <>
              <Button variant="ghost" size="md" onClick={resetForm}>
                {t("settings.cancel")}
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={saving}
                onClick={() => void save()}
              >
                {t("settings.save")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="md" icon={Plus} onClick={startCreate}>
                {t("settings.newLabel")}
              </Button>
              <Button variant="ghost" size="md" onClick={onClose}>
                {t("settings.dialogClose")}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          {error && <InlineNotice variant="error">{error}</InlineNotice>}
          <InlineNotice variant="info">
            {t("settings.labelDialogHint")}
          </InlineNotice>

          <div>
            <SectionLabel>
              {t("settings.builtinLabels")} · {categories.length}
            </SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {categories.map((category) => (
                <Chip
                  key={category}
                  size="md"
                  variant="neutral"
                  icon={<FilterIcon kind="category" value={category} />}
                >
                  {t(`filter.${category}`)}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>
              {t("settings.customLabels")} · {items.length}
            </SectionLabel>
            {items.length === 0 ? (
              <p className="mt-2 text-xs text-muted">
                {t("settings.customLabelsEmpty")}
              </p>
            ) : (
              <div className="mt-2 space-y-1">
                {items.map((def) => {
                  const Icon = LABEL_ICONS[labelIconKey(def.icon)];
                  const colorKey = labelColorKey(def.color);
                  return (
                    <div
                      key={def.key}
                      className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 dark:bg-slate-800"
                    >
                      <Icon className="size-4 shrink-0 text-slate-500 dark:text-slate-400" />
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${LABEL_COLORS[colorKey].dot}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-secondary">
                        {def.name}
                      </span>
                      <span className="hidden shrink-0 font-mono text-[10px] text-muted sm:block">
                        {def.key}
                      </span>
                      <IconButton
                        label={t("settings.editLabel")}
                        icon={Pencil}
                        tone="neutral"
                        size="sm"
                        onClick={() => startEdit(def)}
                      />
                      <IconButton
                        label={t("settings.deleteLabel")}
                        icon={Trash2}
                        tone="danger"
                        size="sm"
                        onClick={() => setDeleteTarget(def)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {formOpen && (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <SectionLabel>
                {editingKey ? t("settings.editLabel") : t("settings.newLabel")}
              </SectionLabel>
              <div>
                <SectionLabel size="xs">{t("settings.labelName")}</SectionLabel>
                <Input
                  size="sm"
                  type="text"
                  value={name}
                  onChange={(event) => handleNameChange(event.target.value)}
                  placeholder={t("settings.labelNamePlaceholder")}
                  className="mt-1.5 w-full"
                />
              </div>
              <div>
                <SectionLabel size="xs">{t("settings.labelKey")}</SectionLabel>
                <Input
                  size="sm"
                  type="text"
                  value={key}
                  onChange={(event) => handleKeyChange(event.target.value)}
                  placeholder={t("settings.labelKeyPlaceholder")}
                  disabled={Boolean(editingKey)}
                  className="mt-1.5 w-full font-mono"
                />
              </div>
              <div>
                <SectionLabel size="xs">{t("settings.labelIcon")}</SectionLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(LABEL_ICONS).map(([iconKey, Icon]) => (
                    <button
                      key={iconKey}
                      type="button"
                      aria-label={iconKey}
                      onClick={() => setIcon(iconKey)}
                      className={`flex size-8 items-center justify-center rounded-md transition-colors ${
                        icon === iconKey
                          ? "bg-brand-700 text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                      }`}
                    >
                      <Icon className="size-4" />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel size="xs">{t("settings.labelColor")}</SectionLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {LABEL_COLOR_KEYS.map((colorKey) => (
                    <button
                      key={colorKey}
                      type="button"
                      aria-label={colorKey}
                      onClick={() => setColor(colorKey)}
                      className={`size-7 rounded-full transition-transform ${
                        color === colorKey
                          ? "ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-900"
                          : ""
                      } ${LABEL_COLORS[colorKey].dot}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("settings.deleteLabel")}
        description={
          deleteTarget
            ? t("settings.deleteLabelConfirm", { name: deleteTarget.name })
            : ""
        }
        confirmLabel={t("settings.deleteLabel")}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
