import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  Plus,
  Settings2,
} from "lucide-react";
import { Button } from "../../../components/Button";
import { EmptyState } from "../../../components/EmptyState";
import { IconButton } from "../../../components/IconButton";
import { Select } from "../../../components/Select";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { LABEL_COLORS } from "../../../lib/labelDefs";
import { isComposing } from "../../../lib/ime";
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
  type Semester,
  type WeekStart,
} from "../../../lib/study";
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
  semesters,
  semester,
  onSemesterChange,
  onManageSemesters,
  weekStart,
  onWeekStartChange,
  showAllWeeks,
  onShowAllWeeksChange,
  currentWeek,
  actualWeek,
  onWeekChange,
  onResetWeek,
  today,
  onAdd,
  onOpenDetail,
  onOpenCourseHomework,
}: {
  courses: Course[];
  homework: Homework[];
  semesters: Semester[];
  semester: Semester;
  onSemesterChange: (id: string) => void;
  onManageSemesters: () => void;
  weekStart: WeekStart;
  onWeekStartChange: (value: WeekStart) => void;
  showAllWeeks: boolean;
  onShowAllWeeksChange: (value: boolean) => void;
  currentWeek: number;
  actualWeek: number;
  onWeekChange: (week: number) => void;
  onResetWeek: () => void;
  today: Date;
  onAdd: () => void;
  onOpenDetail: (course: Course) => void;
  onOpenCourseHomework: (courseId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "zh-CN";
  const [slotCourses, setSlotCourses] = useState<Course[] | null>(null);
  const [stackOverlay, setStackOverlay] = useState<{
    key: string;
    courses: Course[];
  } | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stackOverlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      if (event.key === "Escape") setStackOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stackOverlay]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return undefined;
  }, [lang]);

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

  const openStackOverlay = (
    _event: { currentTarget: HTMLElement },
    key: string,
    courses: Course[],
  ) => {
    setStackOverlay({ key, courses });
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t("study.semester")}
            value={semester.id}
            onChange={(event) => onSemesterChange(event.target.value)}
            className="w-44"
          >
            {semesters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <IconButton
            label={t("study.manageSemesters")}
            icon={Settings2}
            size="sm"
            tone="neutral"
            onClick={onManageSemesters}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t("study.previousWeek")}
              onClick={() => onWeekChange(Math.max(1, currentWeek - 1))}
              className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </button>
            <span className="min-w-20 text-center text-sm font-medium text-secondary">
              {t("study.weekInfo", {
                week: currentWeek,
                parity: t(
                  parity === "odd" ? "study.oddWeek" : "study.evenWeek",
                ),
              })}
            </span>
            <button
              type="button"
              aria-label={t("study.nextWeek")}
              onClick={() =>
                onWeekChange(Math.min(semester.weekCount, currentWeek + 1))
              }
              className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>
          {currentWeek !== actualWeek && (
            <Button variant="ghost" size="sm" onClick={onResetWeek}>
              {t("study.backToThisWeek")}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted">
        {semester.startDate} ~ {semester.endDate ?? ""} ·{" "}
        {t("study.weekCount", { count: semester.weekCount })}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            value={weekStart}
            onChange={onWeekStartChange}
            options={[
              { value: "monday", label: t("study.weekStartMonday") },
              { value: "sunday", label: t("study.weekStartSunday") },
            ]}
          />
          <SegmentedControl
            value={showAllWeeks ? "all" : "current"}
            onChange={(value) => onShowAllWeeksChange(value === "all")}
            options={[
              { value: "all", label: t("study.allWeeks") },
              { value: "current", label: t("study.currentWeekOnly") },
            ]}
          />
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
          {t("study.addCourse")}
        </Button>
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
        <div className="mt-4 flex items-start">
          <div
            data-testid="time-axis"
            className={`relative shrink-0 ${gutterClass}`}
            style={{ height: gridHeight, marginTop: headerHeight }}
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
          <div className="min-w-0 flex-1 overflow-hidden border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
            <div
              ref={headerRef}
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
                          {block.columns.map((column, columnIndex) => {
                            const sameTime =
                              column.courses.length > 1 &&
                              column.courses.every(
                                (course) =>
                                  course.startMin ===
                                    column.courses[0].startMin &&
                                  course.endMin === column.courses[0].endMin,
                              );
                            if (sameTime) {
                              const top =
                                column.courses[column.courses.length - 1];
                              const depth = column.courses.length;
                              const density = courseCardDensity(blockHeightPx);
                              const stackKey = `${day}-${block.startMin}-${block.endMin}-${columnIndex}`;
                              if (stackOverlay?.key === stackKey) return null;
                              return (
                                <div
                                  key={top.id}
                                  role="button"
                                  tabIndex={0}
                                  data-testid={`course-stack-${top.id}`}
                                  aria-expanded={false}
                                  aria-label={t("study.stackCount", {
                                    count: depth,
                                  })}
                                  onClick={(event) =>
                                    openStackOverlay(
                                      event,
                                      stackKey,
                                      column.courses,
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (isComposing(event)) return;
                                    if (
                                      event.key === "Enter" ||
                                      event.key === " "
                                      ) {
                                        event.preventDefault();
                                        openStackOverlay(
                                          event,
                                          stackKey,
                                          column.courses,
                                        );
                                      }
                                    }}
                                  className="absolute"
                                  style={{
                                    left: `${column.left}%`,
                                    width: `${column.width}%`,
                                    top: blockTopPx,
                                    height: blockHeightPx,
                                  }}
                                >
                                  {Array.from(
                                    { length: Math.min(1, depth - 1) },
                                    (_, index) => (
                                      <div
                                        key={index}
                                        data-testid="stack-edge"
                                        aria-hidden
                                        className="absolute inset-0 rounded-sm bg-white ring-1 ring-slate-200/70 dark:bg-slate-800 dark:ring-slate-700"
                                        style={{
                                          transform: `translate(${(index + 1) * 3}px, ${(index + 1) * 3}px)`,
                                        }}
                                      />
                                    ),
                                  )}
                                  <div className="absolute inset-0 overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-slate-200/70 transition-all hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-slate-800 dark:ring-slate-700">
                                    <span
                                      className={`absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-xs ${LABEL_COLORS[top.color].dot}`}
                                    />
                                    <div
                                      className={`relative px-2.5 pl-3 pr-6 ${
                                        density === "compact"
                                          ? "py-0.5"
                                          : "py-1.5"
                                      }`}
                                    >
                                      {density === "compact" ? (
                                        <div className="flex items-baseline gap-1">
                                          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-strong">
                                            {top.name}
                                          </span>
                                          <span className="shrink-0 text-[9px] tabular-nums text-muted">
                                            {formatClockRange(
                                              top.startMin,
                                              top.endMin,
                                              lang,
                                            )}
                                          </span>
                                        </div>
                                      ) : (
                                        <>
                                          <div
                                            className={`text-xs font-semibold text-strong ${
                                              density === "full"
                                                ? "line-clamp-2"
                                                : "truncate"
                                            }`}
                                          >
                                            {top.name}
                                          </div>
                                          <div className="truncate text-[10px] tabular-nums text-muted">
                                            {formatClockRange(
                                              top.startMin,
                                              top.endMin,
                                              lang,
                                            )}
                                          </div>
                                          {weekBadge(top) && (
                                            <div className="mt-0.5">
                                              <span className="rounded-xs bg-slate-100 px-1.5 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-600/70 dark:text-slate-100">
                                                {weekBadge(top)}
                                              </span>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    <span
                                      aria-hidden
                                      className="absolute right-1 top-1 z-10 inline-flex items-center gap-0.5 rounded-xs bg-slate-900/70 px-1 py-px text-[9px] font-semibold text-white"
                                    >
                                      <Layers aria-hidden className="size-3" />
                                      {depth}
                                    </span>
                                  </div>
                                </div>
                              );
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
        </div>
      )}

      {stackOverlay && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/15"
            aria-hidden
            onClick={() => setStackOverlay(null)}
          />
          {(() => {
            const MAX_FAN = 4;
            const CARD_W = 320;
            const CARD_H = 240;
            const COL_GAP = 16;
            const ROW_GAP = 8;
            const visible = stackOverlay.courses.slice(0, MAX_FAN);
            const overflow = stackOverlay.courses.slice(MAX_FAN);
            const cols = visible.length <= 2 ? visible.length : 2;
            const rows = Math.ceil(visible.length / cols);
            const totalW = cols * CARD_W + (cols - 1) * COL_GAP;
            const totalH = rows * CARD_H + (rows - 1) * ROW_GAP;
            const startX = Math.max(
              8,
              Math.floor((window.innerWidth - totalW) / 2),
            );
            const startY = Math.max(
              8,
              Math.floor((window.innerHeight - totalH) / 2),
            );
            const positionOf = (index: number) => ({
              left: startX + (index % cols) * (CARD_W + COL_GAP),
              top: startY + Math.floor(index / cols) * (CARD_H + ROW_GAP),
            });
            return (
              <>
                {visible.map((course, index) => {
                  const pos = positionOf(index);
                  const dealStyle = {
                    left: pos.left,
                    top: pos.top,
                    width: CARD_W,
                    animationDelay: `${index * 40}ms`,
                    "--deal-rotate": `${index % 2 === 0 ? -1.5 : 1.5}deg`,
                  } as CSSProperties;
                  return (
                    <button
                      key={course.id}
                      type="button"
                      data-testid={`spread-card-${course.id}`}
                      onClick={() => {
                        onOpenDetail(course);
                        setStackOverlay(null);
                      }}
                      className="deal-in fixed z-50 flex flex-col rounded-lg border border-slate-200 bg-white p-3 text-left shadow-pop ring-1 ring-slate-200/60 transition-all hover:-translate-y-1 hover:scale-[1.02] hover:shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:ring-slate-700"
                      style={dealStyle}
                    >
                      <span className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 size-3 shrink-0 rounded-full ${LABEL_COLORS[course.color].dot}`}
                        />
                        <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-strong">
                          {course.name}
                        </span>
                      </span>
                      <span className="mt-1.5 text-xs tabular-nums text-muted">
                        {formatClockRange(
                          course.startMin,
                          course.endMin,
                          lang,
                        )}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {weekBadge(course) && (
                          <span className="rounded-xs bg-slate-100 px-1.5 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-600/70 dark:text-slate-100">
                            {weekBadge(course)}
                          </span>
                        )}
                        {homeworkCountOf(course.id) > 0 && (
                          <span className="rounded-xs bg-brand-50 px-1.5 py-px text-[9px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                            {t("study.homeworkCount", {
                              count: homeworkCountOf(course.id),
                            })}
                          </span>
                        )}
                      </span>
                      {(course.teacher || course.location) && (
                        <span className="mt-1.5 break-words text-xs leading-snug text-secondary">
                          {course.teacher}
                          {course.teacher && course.location ? " · " : ""}
                          {course.location}
                        </span>
                      )}
                    </button>
                  );
                })}
                {overflow.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSlotCourses(stackOverlay.courses)}
                    className="fixed z-50 rounded-xs bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-900"
                    style={{
                      left: startX + totalW / 2 - 32,
                      top: startY + totalH + 8,
                    }}
                  >
                    {t("study.slotMore", { count: overflow.length })}
                  </button>
                )}
              </>
            );
          })()}
        </>
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
