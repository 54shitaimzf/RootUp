import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "lucide-react";
import {
  FILTER_STATE_OPTIONS,
  fileStateMeta,
} from "../lib/fileUtils";
import { sortFilterItems, type FilterHabits } from "../lib/filterHabits";
import type { FileRecord } from "../lib/tauri";
import { logEvent } from "../lib/tauri";
import { CATEGORY_ICON } from "./FileTypeIcon";

export interface FilterBarProps {
  categories: string[];
  labels: string[];
  selectedTypes: string[];
  selectedStates: string[];
  selectedLabels: string[];
  habits: FilterHabits;
  onHabitUsed: (key: string) => void;
  onTypesChange: (types: string[]) => void;
  onStatesChange: (states: string[]) => void;
  onLabelsChange: (labels: string[]) => void;
}

type ChipKind = "category" | "state" | "label";

interface ChipItem {
  key: string;
  kind: ChipKind;
  value: string;
}

function chipClass(active: boolean): string {
  return active
    ? "bg-brand-700 text-white"
    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";
}

/** “全部”徽章：空心圆环 + ALL 字标，颜色跟随 currentColor，纯装饰。 */
function AllMedallion() {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center rounded-full border text-[7px] font-bold leading-none tracking-widest"
    >
      ALL
    </span>
  );
}

function ChipIcon({ item }: { item: ChipItem }) {
  if (item.kind === "category") {
    const Icon = CATEGORY_ICON[item.value] ?? CATEGORY_ICON.other;
    return <Icon className="size-3.5 shrink-0" />;
  }
  if (item.kind === "state") {
    const meta = fileStateMeta(item.value as FileRecord["state"]);
    return <span className={`size-2 shrink-0 rounded-full ${meta.dotClass}`} />;
  }
  return <Tag className="size-3.5 shrink-0" />;
}

/** 分组行：左侧固定标题，右侧 chips 单行横向滚动（不换行）。 */
function GroupRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-2.5 first:border-t-0 dark:border-slate-800">
      <span className="w-14 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 筛选条：分类 / 状态 / 标签各自成行，行内横向滚动。
 * 每组按使用习惯排序（已选置前 → count → lastUsed → 原始顺序）；
 * 分类行行首为“全部”徽章，状态行行首为“全部状态”。
 */
export function FilterBar({
  categories,
  labels,
  selectedTypes,
  selectedStates,
  selectedLabels,
  habits,
  onHabitUsed,
  onTypesChange,
  onStatesChange,
  onLabelsChange,
}: FilterBarProps) {
  const { t } = useTranslation();

  const byKind = useMemo(
    () => ({
      category: categories.map((category) => ({
        key: `category:${category}`,
        kind: "category" as const,
        value: category,
      })),
      state: FILTER_STATE_OPTIONS.map((state) => ({
        key: `state:${state}`,
        kind: "state" as const,
        value: state,
      })),
      label: labels.map((label) => ({
        key: `label:${label}`,
        kind: "label" as const,
        value: label,
      })),
    }),
    [categories, labels],
  );

  const orderedCategories = useMemo(
    () =>
      sortFilterItems(
        byKind.category,
        habits,
        selectedTypes.map((value) => `category:${value}`),
      ),
    [byKind.category, habits, selectedTypes],
  );
  const orderedStates = useMemo(
    () =>
      sortFilterItems(
        byKind.state,
        habits,
        selectedStates.map((value) => `state:${value}`),
      ),
    [byKind.state, habits, selectedStates],
  );
  const orderedLabels = useMemo(
    () =>
      sortFilterItems(
        byKind.label,
        habits,
        selectedLabels.map((value) => `label:${value}`),
      ),
    [byKind.label, habits, selectedLabels],
  );

  const isActive = (item: ChipItem) =>
    item.kind === "category"
      ? selectedTypes.includes(item.value)
      : item.kind === "state"
        ? selectedStates.includes(item.value)
        : selectedLabels.includes(item.value);

  const displayName = (item: ChipItem) => {
    if (item.kind === "category") return t(`filter.${item.value}`);
    if (item.kind === "state") {
      const key = `filter.state${item.value[0].toUpperCase()}${item.value.slice(1)}`;
      return t(key);
    }
    return item.value;
  };

  const toggle = (item: ChipItem) => {
    const active = isActive(item);
    onHabitUsed(item.key);
    if (item.kind === "category") {
      const next = active ? [] : [item.value];
      onTypesChange(next);
      void logEvent(
        "info",
        `filter: 切换 kind=category key=${item.value} active=${next.length > 0}`,
      );
    } else if (item.kind === "state") {
      const next = active ? [] : [item.value];
      onStatesChange(next);
      void logEvent(
        "info",
        `filter: 切换 kind=state key=${item.value} active=${next.length > 0}`,
      );
    } else {
      const next = active
        ? selectedLabels.filter((label) => label !== item.value)
        : [...selectedLabels, item.value];
      onLabelsChange(next);
      void logEvent(
        "info",
        `filter: 切换 kind=label key=${item.value} active=${!active}`,
      );
    }
  };

  const renderChip = (item: ChipItem) => {
    const active = isActive(item);
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => toggle(item)}
        className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${chipClass(active)}`}
      >
        <ChipIcon item={item} />
        <span>{displayName(item)}</span>
      </button>
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <GroupRow label={t("filter.types")}>
        <button
          type="button"
          onClick={() => onTypesChange([])}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${chipClass(selectedTypes.length === 0)}`}
        >
          <AllMedallion />
          <span>{t("filter.all")}</span>
        </button>
        {orderedCategories.map(renderChip)}
      </GroupRow>
      <GroupRow label={t("filter.states")}>
        <button
          type="button"
          onClick={() => onStatesChange([])}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${chipClass(selectedStates.length === 0)}`}
        >
          <span className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("filter.stateAll")}</span>
        </button>
        {orderedStates.map(renderChip)}
      </GroupRow>
      {labels.length > 0 && (
        <GroupRow label={t("filter.labels")}>
          {orderedLabels.map(renderChip)}
        </GroupRow>
      )}
    </div>
  );
}
