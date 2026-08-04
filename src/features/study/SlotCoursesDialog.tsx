import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { LABEL_COLORS } from "../../lib/labelDefs";
import {
  formatClockRange,
  type Course,
} from "../../lib/study";

export function SlotCoursesDialog({
  open,
  courses,
  onSelect,
  onClose,
}: {
  open: boolean;
  courses: Course[];
  onSelect: (course: Course) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "zh-CN";
  const sorted = [...courses].sort(
    (a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id),
  );

  return (
    <Modal
      open={open}
      title={t("study.slotCourses")}
      onClose={onClose}
      width="max-w-sm"
    >
      <ul className="space-y-2">
        {sorted.map((course) => {
          const badge =
            course.weekRule === "odd"
              ? t("study.weekRuleOdd")
              : course.weekRule === "even"
                ? t("study.weekRuleEven")
                : course.weekRule === "range"
                  ? course.weekRange ?? ""
                  : null;
          return (
            <li key={course.id}>
              <button
                type="button"
                onClick={() => onSelect(course)}
                className="flex w-full items-center gap-2.5 rounded-md border border-slate-200 px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
              >
                <span
                  className={`size-2.5 shrink-0 rounded-full ${LABEL_COLORS[course.color].dot}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-strong">
                  {course.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted">
                  {formatClockRange(course.startMin, course.endMin, lang)}
                </span>
                {badge && (
                  <span className="shrink-0 rounded-xs bg-slate-100 px-1.5 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    {badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
