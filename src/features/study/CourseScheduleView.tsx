import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedControl } from "../../components/SegmentedControl";
import { LABEL_COLORS } from "../../lib/labelDefs";
import { isComposing } from "../../lib/ime";
import {
  axisRange,
  axisTopPercent,
  courseCardDensity,
  formatClock,
  formatClockRange,
  jsDayToStudyDay,
  layoutDayCourses,
  sessionActiveInWeek,
  weekDaysOrder,
  weekParity,
  type Course,
  type CourseCardDensity,
  type Homework,
  type WeekStart,
} from "../../lib/study";
import { SlotCoursesDialog } from "./SlotCoursesDialog";

const HOUR_HEIGHT = 56;
const MIN_CARD_HEIGHT = 28;
const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function weekDates(today: Date, weekStart: WeekStart): Date[] {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const jsDay = base.getDay();
  const startOffset =
    weekStart === "monday" ? (jsDay === 0 ? -6 : 1 - jsDay) : -jsDay;
  const start = new Date(base);
  start.setDate(base.getDate() + startOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function CourseCard({
  course,
  lang,
  left,
  width,
  topPx,
  heightPx,
  conflict,
  badge,
  homeworkCount,
  homeworkLabel,
  onOpenDetail,
  onOpenCourseHomework,
}: {
  course: Course;
  lang: "zh-CN" | "en";
  left: number;
  width: number;
  topPx: number;
  heightPx: number;
  conflict: boolean;
  badge: string | null;
  homeworkCount: number;
  homeworkLabel: string;
  onOpenDetail: (course: Course) => void;
  onOpenCourseHomework: (courseId: string) => void;
}) {
  const density: CourseCardDensity = courseCardDensity(heightPx);
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`course-card-${course.id}`}
      data-density={density}
      onClick={() => onOpenDetail(course)}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail(course);
        }
      }}
      className={`absolute overflow-hidden rounded-sm bg-white shadow-sm ring-1 transition-all hover:-translate-y-px hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-slate-800 ${
        conflict
          ? "ring-rose-200/90 dark:ring-rose-500/40"
          : "ring-slate-200/70 dark:ring-slate-700"
      }`}
      style={{ left: `${left}%`, width: `${width}%`, top: topPx, height: heightPx }}
    >
      <span
        className={`absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-xs ${LABEL_COLORS[course.color].dot}`}
      />
      <div className={`relative px-2.5 pl-3 ${density === "compact" ? "py-0.5" : "py-1.5"}`}>
        {density === "compact" ? (
          <div className="flex items-baseline gap-1">
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-strong">
              {course.name}
            </span>
            <span className="shrink-0 text-[9px] tabular-nums text-muted">
              {formatClockRange(course.startMin, course.endMin, lang)}
            </span>
          </div>
        ) : (
          <>
            <div
              className={`text-xs font-semibold text-strong ${
                density === "full" ? "line-clamp-2" : "truncate"
              }`}
            >
              {course.name}
            </div>
            <div className="truncate text-[10px] tabular-nums text-muted">
              {formatClockRange(course.startMin, course.endMin, lang)}
            </div>
            {(badge || homeworkCount > 0) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {badge && (
                  <span className="rounded-xs bg-slate-100 px-1.5 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-600/70 dark:text-slate-100">
                    {badge}
                  </span>
                )}
                {homeworkCount > 0 && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCourseHomework(course.id);
                    }}
                    className="rounded-xs bg-brand-50 px-1.5 py-px text-[9px] font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25"
                  >
                    {homeworkLabel}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

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
  onOpenDetail,
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
  onOpenDetail: (course: Course) => void;
  onOpenCourseHomework: (courseId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "zh-CN";
  const [slotCourses, setSlotCourses] = useState<Course[] | null>(null);

  const visibleCourses = showAllWeeks
    ? courses
    : courses.filter((course) =>
        sessionActiveInWeek(course.weekRule, course.weekRange, currentWeek),
      );
  const axis = axisRange(visibleCourses);
  const days = weekDaysOrder(weekStart);
  const dates = weekDates(today, weekStart);
  const todayStudyDay = jsDayToStudyDay(today.getDay());
  const gridHeight = ((axis.end - axis.start) / 60) * HOUR_HEIGHT;
  const parity = weekParity(currentWeek);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const showNowLine = nowMinutes >= axis.start && nowMinutes <= axis.end;
  const gutterClass = lang === "en" ? "w-16" : "w-12";

  const hourMarks: number[] = [];
  for (let min = axis.start; min < axis.end; min += 60) hourMarks.push(min);

  const weekBadge = (course: Course): string | null => {
    if (course.weekRule === "odd") return t("study.weekRuleOdd");
    if (course.weekRule === "even") return t("study.weekRuleEven");
    if (course.weekRule === "range") return course.weekRange ?? "";
    return null;
  };

  const homeworkCountOf = (courseId: string) =>
    homework.filter((item) => item.courseId === courseId).length;

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
        <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
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
        <div className="mt-4 overflow-hidden border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
            <div
              data-testid="schedule-header"
              className="flex border-b border-slate-200 dark:border-slate-800"
            >
              {days.map((day, index) => {
                const date = dates[index];
                const isToday = day === todayStudyDay;
                return (
                  <div
                    key={day}
                    data-testid={`day-header-${day}`}
                    className={`flex flex-1 flex-col items-center gap-0.5 py-2 ${
                      isToday
                        ? "bg-brand-50 dark:bg-brand-500/10"
                        : day >= 6
                          ? "bg-slate-50/70 dark:bg-slate-900/40"
                          : ""
                    }`}
                  >
                    <span
                      className={`text-xs font-medium ${
                        isToday
                          ? "text-brand-700 dark:text-brand-300"
                          : "text-secondary"
                      }`}
                    >
                      {t(`study.${DAY_KEYS[day - 1]}`)}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted">
                      {date.getMonth() + 1}/{date.getDate()}
                    </span>
                    {isToday && (
                      <span className="rounded-xs bg-brand-700 px-2 py-px text-[9px] font-medium text-white">
                        {t("study.today")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex">
              <div
                data-testid="time-axis"
                className={`relative shrink-0 ${gutterClass}`}
                style={{ height: gridHeight }}
              >
                {hourMarks.map((min) => (
                  <span
                    key={min}
                    className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted"
                    style={{ top: `${axisTopPercent(min, axis)}%` }}
                  >
                    {formatClock(min, lang)}
                  </span>
                ))}
              </div>
              {days.map((day, index) => {
                const dayCourses = visibleCourses.filter(
                  (course) => course.day === day,
                );
                const isToday = day === todayStudyDay;
                const isWeekend = day >= 6;
                return (
                  <div
                    key={day}
                    className={`relative flex-1 ${
                      index > 0
                        ? "border-l border-slate-100 dark:border-slate-800/40"
                        : ""
                    } ${
                      isWeekend && !isToday
                        ? "bg-slate-50/60 dark:bg-slate-900/40"
                        : ""
                    }`}
                    style={{ height: gridHeight }}
                  >
                    {hourMarks.map((min) => (
                      <div
                        key={min}
                        className="absolute left-0 right-0 border-t border-slate-100/80 dark:border-slate-800/50"
                        style={{ top: `${axisTopPercent(min, axis)}%` }}
                      />
                    ))}
                    {isToday && (
                      <div className="absolute inset-y-0 left-0 right-0 bg-brand-500/[0.04] dark:bg-brand-500/[0.06]" />
                    )}
                    {isToday && showNowLine && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-10"
                        style={{
                          top: `${axisTopPercent(nowMinutes, axis)}%`,
                        }}
                      >
                        <div className="h-px bg-brand-500" />
                        <div className="absolute -left-0.5 -top-[3px] size-1.5 rounded-full bg-brand-500" />
                      </div>
                    )}
                    {layoutDayCourses(dayCourses).map((block) => {
                      const blockTopPx =
                        (axisTopPercent(block.startMin, axis) / 100) *
                        gridHeight;
                      const blockHeightPx = Math.max(
                        MIN_CARD_HEIGHT,
                        ((block.endMin - block.startMin) / 60) * HOUR_HEIGHT,
                      );
                      const allBlockCourses = [
                        ...block.columns.flatMap((column) => column.courses),
                        ...block.overflow,
                      ].sort(
                        (a, b) =>
                          a.startMin - b.startMin ||
                          a.id.localeCompare(b.id),
                      );
                      return (
                        <Fragment key={`${block.startMin}-${block.endMin}`}>
                          {block.columns.map((column) => {
                            const sameTime =
                              column.courses.length > 1 &&
                              column.courses.every(
                                (course) =>
                                  course.startMin ===
                                    column.courses[0].startMin &&
                                  course.endMin === column.courses[0].endMin,
                              );
                            if (sameTime) {
                              const rowHeightPx = Math.max(
                                MIN_CARD_HEIGHT,
                                blockHeightPx / column.courses.length,
                              );
                              return column.courses.map((course, rowIndex) => (
                                <CourseCard
                                  key={course.id}
                                  course={course}
                                  lang={lang}
                                  left={column.left}
                                  width={column.width}
                                  topPx={blockTopPx + rowIndex * rowHeightPx}
                                  heightPx={rowHeightPx}
                                  conflict={block.conflict}
                                  badge={weekBadge(course)}
                                  homeworkCount={homeworkCountOf(course.id)}
                                  homeworkLabel={t("study.homeworkCount", {
                                    count: homeworkCountOf(course.id),
                                  })}
                                  onOpenDetail={onOpenDetail}
                                  onOpenCourseHomework={onOpenCourseHomework}
                                />
                              ));
                            }
                            return column.courses.map(
                              (course, courseIndex) => {
                                const topPx =
                                  (axisTopPercent(course.startMin, axis) /
                                    100) *
                                    gridHeight +
                                  (column.courses.length > 1
                                    ? courseIndex * 6
                                    : 0);
                                const heightPx = Math.max(
                                  MIN_CARD_HEIGHT,
                                  ((course.endMin - course.startMin) / 60) *
                                    HOUR_HEIGHT,
                                );
                                return (
                                  <CourseCard
                                    key={course.id}
                                    course={course}
                                    lang={lang}
                                    left={column.left}
                                    width={column.width}
                                    topPx={topPx}
                                    heightPx={heightPx}
                                    conflict={block.conflict}
                                    badge={weekBadge(course)}
                                    homeworkCount={homeworkCountOf(course.id)}
                                    homeworkLabel={t("study.homeworkCount", {
                                      count: homeworkCountOf(course.id),
                                    })}
                                    onOpenDetail={onOpenDetail}
                                    onOpenCourseHomework={onOpenCourseHomework}
                                  />
                                );
                              },
                            );
                          })}
                          {block.overflow.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setSlotCourses(allBlockCourses)}
                              className="absolute right-1 z-20 rounded-xs bg-brand-600 px-1.5 py-px text-[9px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
                              style={{ top: blockTopPx + 2 }}
                            >
                              {t("study.slotMore", {
                                count: block.overflow.length,
                              })}
                            </button>
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
      )}

      <SlotCoursesDialog
        open={slotCourses !== null}
        courses={slotCourses ?? []}
        onSelect={(course) => {
          setSlotCourses(null);
          onOpenDetail(course);
        }}
        onClose={() => setSlotCourses(null)}
      />
    </div>
  );
}
