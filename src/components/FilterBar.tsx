import { useTranslation } from "react-i18next";
import { FileTypeIcon } from "./FileTypeIcon";

export interface FilterBarProps {
  categories: string[];
  labels: string[];
  selectedTypes: string[];
  selectedStates: string[];
  selectedLabels: string[];
  onTypesChange: (types: string[]) => void;
  onStatesChange: (states: string[]) => void;
  onLabelsChange: (labels: string[]) => void;
}

const STATE_OPTIONS = ["pending", "indexed"];

function chipClass(active: boolean): string {
  return active
    ? "bg-brand-700 text-white"
    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";
}

/** 独立可复用的分类/状态/标签筛选条：点选组合为查询语法。 */
export function FilterBar({
  categories,
  labels,
  selectedTypes,
  selectedStates,
  selectedLabels,
  onTypesChange,
  onStatesChange,
  onLabelsChange,
}: FilterBarProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("filter.types")}>
        <button
          type="button"
          onClick={() => onTypesChange([])}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${chipClass(
            selectedTypes.length === 0,
          )}`}
        >
          {t("filter.all")}
        </button>
        {categories.map((category) => {
          const active = selectedTypes.includes(category);
          return (
            <button
              key={category}
              type="button"
              onClick={() => onTypesChange(active ? [] : [category])}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${chipClass(
                active,
              )}`}
            >
              <FileTypeIcon category={category} size="sm" />
              {t(`filter.${category}`)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("filter.states")}>
        <button
          type="button"
          onClick={() => onStatesChange([])}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${chipClass(
            selectedStates.length === 0,
          )}`}
        >
          {t("filter.stateAll")}
        </button>
        {STATE_OPTIONS.map((state) => {
          const active = selectedStates.includes(state);
          return (
            <button
              key={state}
              type="button"
              onClick={() => onStatesChange(active ? [] : [state])}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${chipClass(
                active,
              )}`}
            >
              {t(`filter.state${state[0].toUpperCase()}${state.slice(1)}`)}
            </button>
          );
        })}
      </div>

      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("filter.labels")}>
          {labels.map((label) => {
            const active = selectedLabels.includes(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() =>
                  onLabelsChange(
                    active
                      ? selectedLabels.filter((l) => l !== label)
                      : [...selectedLabels, label],
                  )
                }
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${chipClass(
                  active,
                )}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
