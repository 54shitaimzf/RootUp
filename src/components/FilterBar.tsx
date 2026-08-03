import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sortFilterItems, type FilterHabits } from "../lib/filterHabits";
import { logEvent } from "../lib/tauri";
import { Chip } from "./Chip";
import { FilterIcon } from "./FilterIcon";

export interface FilterBarProps {
  categories: string[];
  labels: string[];
  selectedTypes: string[];
  selectedLabels: string[];
  habits: FilterHabits;
  onHabitUsed: (key: string) => void;
  onTypesChange: (types: string[]) => void;
  onLabelsChange: (labels: string[]) => void;
}

type ChipKind = "category" | "label";

interface ChipItem {
  key: string;
  kind: ChipKind;
  value: string;
}

interface OrderSnapshot {
  category: ChipItem[];
  label: ChipItem[];
}

/** 分组行：左侧固定标题，右侧 chips 单行横向滚动（隐藏滚动条 + 滚轮映射 + 双向渐隐 + 悬浮箭头）。 */
function GroupRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1);
      setCanLeft(element.scrollLeft > 1);
      setCanRight(
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [children]);

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  };

  const scrollByStep = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({
      left: direction * 240,
      behavior: "smooth",
    });
  };

  return (
    <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-2.5 first:border-t-0 dark:border-slate-800">
      <span className="w-14 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          aria-label={t("filter.scrollLeft")}
          onClick={() => scrollByStep(-1)}
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 ${
            overflow && canLeft ? "" : "invisible"
          }`}
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            onWheel={onWheel}
            role="group"
            aria-label={label}
            className="no-scrollbar flex items-center gap-1.5 overflow-x-auto"
          >
            {children}
          </div>
          {overflow && canLeft && (
            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent dark:from-slate-900" />
          )}
          {overflow && canRight && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent dark:from-slate-900" />
          )}
        </div>
        <button
          type="button"
          aria-label={t("filter.scrollRight")}
          onClick={() => scrollByStep(1)}
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 ${
            overflow && canRight ? "" : "invisible"
          }`}
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * 筛选条：分类 / 标签各自成行（状态筛选不在界面，保留于搜索语法）。
 * 排序在进入页面时按使用习惯快照一次，会话内稳定；
 * 点击只更新习惯与选中态（选中自动滚入视野），不实时重排。
 */
export function FilterBar({
  categories,
  labels,
  selectedTypes,
  selectedLabels,
  habits,
  onHabitUsed,
  onTypesChange,
  onLabelsChange,
}: FilterBarProps) {
  const { t } = useTranslation();

  const byKind = useMemo<Record<ChipKind, ChipItem[]>>(
    () => ({
      category: categories.map((category) => ({
        key: `category:${category}`,
        kind: "category" as const,
        value: category,
      })),
      label: labels.map((label) => ({
        key: `label:${label}`,
        kind: "label" as const,
        value: label,
      })),
    }),
    [categories, labels],
  );

  // 首次拿到数据时按习惯排序一次，之后只追加新出现的条目，不再重排。
  const snapshotRef = useRef<OrderSnapshot | null>(null);
  if (!snapshotRef.current) {
    snapshotRef.current = { category: [], label: [] };
  }
  const snapshot = snapshotRef.current;
  const selectedKeys = [
    ...selectedTypes.map((value) => `category:${value}`),
    ...selectedLabels.map((value) => `label:${value}`),
  ];
  for (const kind of ["category", "label"] as const) {
    const current = byKind[kind];
    if (snapshot[kind].length === 0 && current.length > 0) {
      snapshot[kind] = sortFilterItems(current, habits, selectedKeys);
    } else if (current.length > 0) {
      const existing = new Set(snapshot[kind].map((item) => item.key));
      const fresh = current.filter((item) => !existing.has(item.key));
      if (fresh.length > 0) {
        snapshot[kind] = [...snapshot[kind], ...fresh];
      }
    }
  }

  const chipRefs = useRef(new Map<string, HTMLElement>());
  const scrollToChip = (key: string) => {
    requestAnimationFrame(() => {
      chipRefs.current
        .get(key)
        ?.scrollIntoView({ inline: "nearest", block: "nearest" });
    });
  };

  const isActive = (item: ChipItem) =>
    item.kind === "category"
      ? selectedTypes.includes(item.value)
      : selectedLabels.includes(item.value);

  const displayName = (item: ChipItem) =>
    item.kind === "category"
      ? t(`filter.${item.value}`)
      : item.value;

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
    scrollToChip(item.key);
  };

  const renderChip = (item: ChipItem) => {
    const active = isActive(item);
    return (
      <Chip
        key={item.key}
        ref={(element) => {
          if (element) {
            chipRefs.current.set(item.key, element);
          } else {
            chipRefs.current.delete(item.key);
          }
        }}
        size="md"
        variant={active ? "active" : "neutral"}
        icon={<FilterIcon kind={item.kind} value={item.value} />}
        onClick={() => toggle(item)}
      >
        {displayName(item)}
      </Chip>
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <GroupRow label={t("filter.types")}>
        <Chip
          size="md"
          variant={selectedTypes.length === 0 ? "active" : "neutral"}
          icon={<FilterIcon kind="all" />}
          onClick={() => onTypesChange([])}
        >
          {t("filter.all")}
        </Chip>
        {snapshot.category.map(renderChip)}
      </GroupRow>
      {snapshot.label.length > 0 && (
        <GroupRow label={t("filter.labels")}>
          {snapshot.label.map(renderChip)}
        </GroupRow>
      )}
    </div>
  );
}
