import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedControl } from "../../components/SegmentedControl";
import { LABEL_COLORS } from "../../lib/labelDefs";
import {
  axisRange,
  coursePosition,
  formatClock,
  formatClockRange,
  jsDayToStudyDay,
  sessionActiveInWeek,
  splitOverlaps,
  weekDaysOrder,
  weekParity,
  type Course,
  type Homework,
  type WeekStart,
} from "../../lib/study";

const HOUR_HEIGHT = 56;
const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export function CourseScheduleView({
  courses,
  homework,
  weekStart,
  onWeekStartChange,
  showAllWeeks,
  onShowAllWeeksChange,
  currentWeek,
  today,
  onAdd,
  onEdit,
  onOpenCourseHomework,
}: {
  courses: Course[];
  homework: Homework[];
  weekStart: WeekStart;
  onWeekStartChange: (value: WeekStart) => void;
  showAllWeeks: boolean;
  onShowAllWeeksChange: (value: boolean) => void;
  currentWeek: number;
  today: Date;
  onAdd: () => void;
  onEdit: (course: Course) => void;
  onOpenCourseHomework: (courseId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "zh-CN";
  const visibleCourses = showAllWeeks
    ? courses
    : courses.filter((course) =>
        sessionActiveInWeek(course.weekRule, course.weekRange, currentWeek),
      );
  const axis = axisRange(visibleCourses);
  const days = weekDaysOrder(weekStart);
  const todayStudyDay = jsDayToStudyDay(today.getDay());
  const gridHeight = ((axis.end - axis.start) / 60) * HOUR_HEIGHT;
  const total = Math.max(1, axis.end - axis.start);
  const parity = weekParity(currentWeek);

  const hourMarks: number[] = [];
  for (let min = axis.start; min < axis.end; min += 60) hourMarks.push(min);

  const weekBadge = (course: Course) => {
    if (course.weekRule === "odd") return t("study.weekRuleOdd");
    if (course.weekRule === "even") return t("study.weekRuleEven");
    if (course.weekRule === "range") return course.weekRange;
    return null;
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-secondary">
            {t("study.weekInfo", {
              week: currentWeek,
              parity: t(parity === "odd" ? "study.oddWeek" : "study.evenWeek"),
            })}
          </span>
          <SegmentedControl
            value={showAllWeeks ? "all" : "current"}
            onChange={(value) => onShowAllWeeksChange(value === "all")}
            options={[
              { value: "all", label: t("study.allWeeks") },
              { value: "current", label: t("study.currentWeekOnly") },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            value={weekStart}
            onChange={onWeekStartChange}
            options={[
              { value: "monday", label: t("study.weekStartMonday") },
              { value: "sunday", label: t("study.weekStartSunday") },
            ]}
          />
          <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
            {t("study.addCourse")}
          </Button>
        </div>
      </div>

      {visibleCourses.length === 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title={
              courses.length === 0
                ? t("study.noCourses")
                : t("study.noVisibleCourses")
            }
            description={
              courses.length === 0
                ? t("study.noCoursesDesc")
                : t("study.noVisibleCoursesDesc")
            }
            action={
              <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
                {t("study.addCourse")}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <div className="w-12 shrink-0" />
            {days.map((day) => (
              <div
                key={day}
                data-testid={`day-header-${day}`}
                className={`flex-1 border-l border-slate-200 py-2 text-center text-xs font-medium dark:border-slate-800 ${
                  day === todayStudyDay
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-secondary"
                }`}
              >
                {t(`study.${DAY_KEYS[day - 1]}`)}
              </div>
            ))}
          </div>
          <div className="flex">
            <div
              className="relative w-12 shrink-0"
              style={{ height: gridHeight }}
            >
              {hourMarks.map((min) => (
                <span
                  key={min}
                  className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted"
                  style={{
                    top: `${((min - axis.start) / total) * 100}%`,
                  }}
                >
                  {formatClock(min, lang).split(" ")[0]}
                </span>
              ))}
            </div>
            {days.map((day) => {
              const dayCourses = visibleCourses.filter(
                (course) => course.day === day,
              );
              const slots = splitOverlaps(dayCourses);
              return (
                <div
                  key={day}
                  className="relative flex-1 border-l border-slate-200 dark:border-slate-800"
                  style={{ height: gridHeight }}
                >
                  {hourMarks.map((min) => (
                    <div
                      key={min}
                      className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800/70"
                      style={{
                        top: `${((min - axis.start) / total) * 100}%`,
                      }}
                    />
                  ))}
                  {day === todayStudyDay && (
                    <div className="absolute inset-y-0 left-0 right-0 bg-brand-500/[0.04] dark:bg-brand-500/[0.06]" />
                  )}
                  {dayCourses.map((course) => {
                    const pos = coursePosition(course, axis);
                    const slot = slots[course.id];
                    const badge = weekBadge(course);
                    const count = homework.filter(
                      (item) => item.courseId === course.id,
                    ).length;
                    return (
                      <div
                        key={course.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onEdit(course)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onEdit(course);
                          }
                        }}
                        className={`absolute overflow-hidden rounded-md border border-slate-200/70 px-2 py-1 text-left shadow-sm transition-transform hover:z-10 hover:scale-[1.02] dark:border-slate-700/70 ${LABEL_COLORS[course.color].chip}`}
                        style={{
                          top: `${pos.top}%`,
                          height: `${pos.height}%`,
                          left: `${slot.left}%`,
                          width: `${slot.width}%`,
                        }}
                      >
                        <div className="truncate text-xs font-semibold">
                          {course.name}
                        </div>
                        <div className="truncate text-[10px] opacity-80">
                          {formatClockRange(course.startMin, course.endMin, lang)}
                        </div>
                        {(course.location || course.teacher) && (
                          <div className="truncate text-[10px] opacity-70">
                            {course.location}
                            {course.location && course.teacher ? " · " : ""}
                            {course.teacher}
                          </div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {badge && (
                            <span className="rounded bg-black/10 px-1 text-[9px] font-medium dark:bg-white/10">
                              {badge}
                            </span>
                          )}
                          {count > 0 && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenCourseHomework(course.id);
                              }}
                              className="rounded bg-black/5 px-1 text-[9px] font-medium hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
                            >
                              {t("study.homeworkCount", { count })}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
