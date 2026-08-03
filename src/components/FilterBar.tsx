import { useMemo } from "react";
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

/**
 * 筛选条：一条横向滚动列表。
 * 排序：全部固定最前 → 已选其次 → count 降序 → lastUsed 降序 → 原始顺序；
 * 点击切换选中并计入使用习惯，同时写入日志。
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

  const items = useMemo<ChipItem[]>(
    () => [
      ...categories.map((category) => ({
        key: `category:${category}`,
        kind: "category" as const,
        value: category,
      })),
      ...FILTER_STATE_OPTIONS.map((state) => ({
        key: `state:${state}`,
        kind: "state" as const,
        value: state,
      })),
      ...labels.map((label) => ({
        key: `label:${label}`,
        kind: "label" as const,
        value: label,
      })),
    ],
    [categories, labels],
  );

  const selectedKeys = useMemo(
    () => [
      ...selectedTypes.map((value) => `category:${value}`),
      ...selectedStates.map((value) => `state:${value}`),
      ...selectedLabels.map((value) => `label:${value}`),
    ],
    [selectedTypes, selectedStates, selectedLabels],
  );

  const ordered = useMemo(
    () => sortFilterItems(items, habits, selectedKeys),
    [items, habits, selectedKeys],
  );

  const allActive =
    selectedTypes.length === 0 &&
    selectedStates.length === 0 &&
    selectedLabels.length === 0;

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

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            onTypesChange([]);
            onStatesChange([]);
            onLabelsChange([]);
          }}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${chipClass(allActive)}`}
        >
          <span className="size-3.5 shrink-0" aria-hidden="true" />
          {t("filter.all")}
        </button>
        {ordered.map((item) => {
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
        })}
      </div>
    </div>
  );
}
