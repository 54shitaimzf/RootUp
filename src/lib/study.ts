import { LABEL_COLOR_KEYS, type LabelColorKey } from "./labelDefs";

/** 学业页类型与纯函数：下一轮后端按此结构 1:1 落地。 */

export type WeekRule = "all" | "odd" | "even" | "range";
export type HomeworkStatus = "pending" | "done" | "archived";
export type StudyView = "schedule" | "homework";
export type WeekStart = "monday" | "sunday";
export type HomeworkStatusFilter = "all" | "active" | HomeworkStatus;

export interface Course {
  id: string;
  name: string;
  teacher: string;
  location: string;
  /** 1=周一 … 7=周日 */
  day: number;
  /** 距 0 点的分钟数 */
  startMin: number;
  endMin: number;
  weekRule: WeekRule;
  weekRange?: string;
  color: LabelColorKey;
  /** 后端生成的稳定课程标签键（course-<id>），前端只读展示。 */
  labelKey?: string;
  /** 课程别名：项目名/路径按课程名或别名匹配（0.8.7 阶段二课程挂钩）。 */
  aliases?: string[];
}

export type CourseDraft = Omit<Course, "id">;

export interface Homework {
  id: string;
  courseId: string | null;
  title: string;
  /** 短备注：行内显示，≤200 字 */
  note: string;
  /** 长详情：可完整记录题目/要求，≤5000 字；后续 AI 摘要的输入字段 */
  details: string;
  dueAt: string;
  status: HomeworkStatus;
}

export type HomeworkDraft = Omit<Homework, "id">;

export const WEEK_MIN = 1;
export const WEEK_MAX = 30;
export const WEEK_RANGE_PATTERN = /^\d+(-\d+)?(,\d+(-\d+)?)*$/;
export const DEFAULT_AXIS = { start: 8 * 60, end: 22 * 60 };
export const DEMO_SEMESTER_START = "2026-08-03";

/** 确定性名称比较：固定中文排序规则，避免运行时 locale 不同导致顺序漂移（CI 与本地不一致）。 */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN");
}

/** 确定性 id/ASCII 比较：按码点比较，避免 locale 影响。 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 学期生命周期：名称走 i18n，startDate 用于推算当前周，weekCount 限定周次范围。*/
export interface Semester {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  weekCount: number;
}

export const DEMO_SEMESTERS: Semester[] = [
  {
    id: "fall-2026",
    name: "2026 秋季学期",
    startDate: "2026-08-03",
    endDate: "2026-12-20",
    weekCount: 20,
  },
  {
    id: "spring-2027",
    name: "2027 春季学期",
    startDate: "2027-03-01",
    endDate: "2027-07-18",
    weekCount: 20,
  },
];

/** 周次钳制：1..weekCount。*/
export function clampWeek(week: number, weekCount: number): number {
  return Math.max(1, Math.min(week, weekCount));
}

/** 指定周次格式校验：如 2-16、1,3,5-8，数值均在 1–30 且区间合法。 */
export function isValidWeekRange(value: string): boolean {
  const trimmed = value.trim();
  if (!WEEK_RANGE_PATTERN.test(trimmed)) return false;
  for (const part of trimmed.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (Number.isNaN(a) || a < WEEK_MIN || a > WEEK_MAX) return false;
    if (b !== undefined && (Number.isNaN(b) || b < WEEK_MIN || b > WEEK_MAX || b < a)) {
      return false;
    }
  }
  return true;
}

export function parseWeekRange(value: string): Set<number> | null {
  if (!isValidWeekRange(value)) return null;
  const weeks = new Set<number>();
  for (const part of value.trim().split(",")) {
    const [a, b] = part.split("-").map(Number);
    const end = b ?? a;
    for (let week = a; week <= end; week += 1) weeks.add(week);
  }
  return weeks;
}

/** 从开学日期（周一）推算今天所在的周次，最小为第 1 周。 */
export function weekNumberFromDate(semesterStart: string, today: Date): number {
  const start = new Date(`${semesterStart}T00:00:00`);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

export function weekParity(week: number): "odd" | "even" {
  return week % 2 === 1 ? "odd" : "even";
}

export function sessionActiveInWeek(
  rule: WeekRule,
  range: string | undefined,
  week: number,
): boolean {
  if (rule === "all") return true;
  if (rule === "odd") return week % 2 === 1;
  if (rule === "even") return week % 2 === 0;
  if (rule === "range") {
    if (!range) return false;
    return parseWeekRange(range)?.has(week) ?? false;
  }
  return false;
}

/** 时间轴范围：取课程最早开始/最晚结束并整点向外取整；空数据用默认 08:00–22:00。 */
export function axisRange(
  courses: Pick<Course, "startMin" | "endMin">[],
): { start: number; end: number } {
  if (courses.length === 0) return DEFAULT_AXIS;
  const min = Math.min(...courses.map((course) => course.startMin));
  const max = Math.max(...courses.map((course) => course.endMin));
  return { start: Math.floor(min / 60) * 60, end: Math.ceil(max / 60) * 60 };
}

export function coursePosition(
  course: Course,
  axis: { start: number; end: number },
): { top: number; height: number } {
  const total = Math.max(1, axis.end - axis.start);
  return {
    top: Math.max(0, ((course.startMin - axis.start) / total) * 100),
    height: Math.max(2, ((course.endMin - course.startMin) / total) * 100),
  };
}

/** 同日重叠课程：按连通区间分组，组内均分列宽。 */
export function splitOverlaps(
  courses: Course[],
): Record<string, { left: number; width: number }> {
  const sorted = [...courses].sort(
    (a, b) => a.startMin - b.startMin || compareIds(a.id, b.id),
  );
  const groups: Course[][] = [];
  let current: Course[] = [];
  let groupEnd = -1;
  for (const course of sorted) {
    if (current.length === 0) {
      current = [course];
      groupEnd = course.endMin;
    } else if (course.startMin < groupEnd) {
      current.push(course);
      groupEnd = Math.max(groupEnd, course.endMin);
    } else {
      groups.push(current);
      current = [course];
      groupEnd = course.endMin;
    }
  }
  if (current.length > 0) groups.push(current);

  const result: Record<string, { left: number; width: number }> = {};
  for (const group of groups) {
    const members = [...group].sort(
      (a, b) => a.startMin - b.startMin || compareIds(a.id, b.id),
    );
    const width = 100 / members.length;
    members.forEach((member, index) => {
      result[member.id] = { left: index * width, width };
    });
  }
  return result;
}

/** 时间显示：中文 24 小时制，English 12 小时 AM/PM。 */
/** 判断两门课的周次是否会在同一周上课（按 1–30 周采样）。*/
export function weeksOverlap(
  a: Pick<Course, "weekRule" | "weekRange">,
  b: Pick<Course, "weekRule" | "weekRange">,
): boolean {
  const weeksA = weekSetOf(a.weekRule, a.weekRange);
  const weeksB = weekSetOf(b.weekRule, b.weekRange);
  for (const week of weeksA) {
    if (weeksB.has(week)) return true;
  }
  return false;
}

function weekSetOf(rule: WeekRule, range: string | undefined): Set<number> {
  if (rule === "all") {
    return new Set(
      Array.from({ length: WEEK_MAX }, (_, index) => index + 1),
    );
  }
  if (rule === "odd") {
    return new Set(
      Array.from({ length: WEEK_MAX }, (_, index) => index + 1).filter(
        (week) => week % 2 === 1,
      ),
    );
  }
  if (rule === "even") {
    return new Set(
      Array.from({ length: WEEK_MAX }, (_, index) => index + 1).filter(
        (week) => week % 2 === 0,
      ),
    );
  }
  return parseWeekRange(range ?? "") ?? new Set<number>();
}

/** 时间轴内某个分钟值对应的顶部百分比（刻度与网格线共用，保证对齐）。*/
export function axisTopPercent(
  min: number,
  axis: { start: number; end: number },
): number {
  const total = Math.max(1, axis.end - axis.start);
  return ((min - axis.start) / total) * 100;
}

/** 课程卡内容密度：完整 / 标准 / 紧凑。*/
export type CourseCardDensity = "full" | "standard" | "compact";

export function courseCardDensity(heightPx: number): CourseCardDensity {
  if (heightPx >= 64) return "full";
  if (heightPx >= 40) return "standard";
  return "compact";
}

/** 一个时段块内的一列（列上课程周次互斥）。*/
export interface SlotColumn {
  courses: Course[];
  /** 列左偏移 0–100 */
  left: number;
  /** 列宽 0–100 */
  width: number;
}

/** 时间连通分量的排布块：列 + 溢出 + 是否同周冲突。*/
export interface SlotBlock {
  startMin: number;
  endMin: number;
  columns: SlotColumn[];
  /** 第 3 列起收起的课程，由 +N 入口打开 */
  overflow: Course[];
  conflict: boolean;
}

/** 同列课程按上课顺序排序：开始时间 → 结束时间 → 名称 → id。*/
function sortBySchedule(a: Course, b: Course): number {
  return (
    a.startMin - b.startMin ||
    a.endMin - b.endMin ||
    compareNames(a.name, b.name) ||
    compareIds(a.id, b.id)
  );
}

/**
 * 同一天课程的排布：
 * 1. 按时间重叠切成连通分量；
 * 2. 分量内贪心分列，同列课程周次互斥（不会同周共上一门课）；
 * 3. 最多显示 2 列，多余课程进入 overflow 由 +N 收起。
 */
export function layoutDayCourses(dayCourses: Course[]): SlotBlock[] {
  const sorted = [...dayCourses].sort(
    (a, b) => a.startMin - b.startMin || compareIds(a.id, b.id),
  );
  const components: Course[][] = [];
  let current: Course[] = [];
  let groupEnd = -1;
  for (const course of sorted) {
    if (current.length === 0) {
      current = [course];
      groupEnd = course.endMin;
    } else if (course.startMin < groupEnd) {
      current.push(course);
      groupEnd = Math.max(groupEnd, course.endMin);
    } else {
      components.push(current);
      current = [course];
      groupEnd = course.endMin;
    }
  }
  if (current.length > 0) components.push(current);

  return components.map((component) => {
    const startMin = Math.min(...component.map((course) => course.startMin));
    const endMin = Math.max(...component.map((course) => course.endMin));
    const columns: Course[][] = [];
    for (const course of component) {
      const columnIndex = columns.findIndex((column) =>
        column.every((member) => !weeksOverlap(member, course)),
      );
      if (columnIndex === -1) {
        columns.push([course]);
      } else {
        columns[columnIndex].push(course);
      }
    }
    const sortedColumns = columns.map((column) =>
      [...column].sort(sortBySchedule),
    );
    const visible = sortedColumns.slice(0, 2);
    const overflow = sortedColumns.slice(2).flat();
    return {
      startMin,
      endMin,
      columns: visible.map((courses, index) => ({
        courses,
        left: (index * 100) / Math.max(1, visible.length),
        width: 100 / Math.max(1, visible.length),
      })),
      overflow,
      conflict: columns.length > 1,
    };
  });
}

/** 默认课程时长与快捷选项（分钟）。*/
export const DEFAULT_COURSE_DURATION = 100;
export const COURSE_DURATION_PRESETS = [45, 60, 90, 100, 120] as const;

/** 按 5 分钟取整并钳制在 00:00–23:55。*/
export function snapToFiveMinutes(min: number): number {
  return Math.max(0, Math.min(23 * 60 + 55, Math.round(min / 5) * 5));
}

/** 结束时间 = 开始 + 时长，最晚不跨午夜（23:55）。*/
export function clampCourseEnd(startMin: number, duration: number): number {
  return Math.min(startMin + duration, 23 * 60 + 55);
}

/** 周次范围容错：全角数字/逗号/短横转半角，去空格与“周”字。*/
export function normalizeWeekRange(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0);
    if (code !== undefined && code >= 0xff10 && code <= 0xff19) {
      out += String.fromCharCode(code - 0xff10 + 0x30);
    } else if (char === "，" || char === "、" || char === "；") {
      out += ",";
    } else if (char === "－" || char === "–" || char === "—") {
      out += "-";
    } else {
      out += char;
    }
  }
  return out.replace(/[\s\u3000周]/g, "");
}

/** 与草稿同星期、时间重叠且周次有交集的既有课程（编辑时排除自身）。*/
export function courseConflicts(
  draft: Pick<
    Course,
    "day" | "startMin" | "endMin" | "weekRule" | "weekRange"
  >,
  existing: Course[],
  excludeId?: string,
): Course[] {
  return existing.filter((course) => {
    if (course.id === excludeId) return false;
    if (course.day !== draft.day) return false;
    if (course.startMin >= draft.endMin || draft.startMin >= course.endMin) {
      return false;
    }
    return weeksOverlap(course, draft);
  });
}

/** 作业状态色相：待办 / 逾期 / 已完成 / 已归档。*/
export type HomeworkStatusTone = "pending" | "overdue" | "done" | "archived";

export function homeworkStatusTone(
  status: HomeworkStatus,
  dueAt: string,
  now: Date,
): HomeworkStatusTone {
  if (status === "pending" && new Date(dueAt).getTime() < now.getTime()) {
    return "overdue";
  }
  if (status === "done") return "done";
  if (status === "archived") return "archived";
  return "pending";
}

/** 按课程周次规则找 30 周内最近一次上课日；找不到回退 7 天后。*/
export function suggestDueForCourse(
  course: Pick<Course, "day" | "weekRule" | "weekRange">,
  today: Date,
  semesterStart = DEMO_SEMESTER_START,
): string {
  const currentWeek = weekNumberFromDate(semesterStart, today);
  const base = new Date(`${semesterStart}T00:00:00`);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  for (let week = currentWeek; week <= WEEK_MAX; week += 1) {
    if (!sessionActiveInWeek(course.weekRule, course.weekRange, week)) continue;
    const date = new Date(base);
    date.setDate(base.getDate() + (week - 1) * 7 + (course.day - 1));
    if (date.getTime() < startOfToday.getTime()) continue;
    return toISODate(date);
  }
  const fallback = new Date(today);
  fallback.setDate(fallback.getDate() + 7);
  return toISODate(fallback);
}

function toISODate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

export function formatClock(min: number, lang: "zh-CN" | "en"): string {
  const hour = Math.floor(min / 60) % 24;
  const minute = String(min % 60).padStart(2, "0");
  if (lang === "zh-CN") {
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour12}:${minute} ${suffix}`;
}

export function formatClockRange(
  start: number,
  end: number,
  lang: "zh-CN" | "en",
): string {
  return `${formatClock(start, lang)}–${formatClock(end, lang)}`;
}

export function timeToMin(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function jsDayToStudyDay(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

export function weekDaysOrder(weekStart: WeekStart): number[] {
  return weekStart === "monday" ? [1, 2, 3, 4, 5, 6, 7] : [7, 1, 2, 3, 4, 5, 6];
}

export function isOverdue(homework: Homework, now: Date): boolean {
  return (
    homework.status === "pending" &&
    new Date(homework.dueAt).getTime() < now.getTime()
  );
}

/** 临期判定：0 ≤ 距截止自然日 ≤ leadDays（与提醒分组共用）。 */
export function isDueSoon(dueAt: string, leadDays: number, now: Date): boolean {
  const days = calendarDaysUntil(dueAt, now);
  return days >= 0 && days <= leadDays;
}

export type ReminderGroup = "overdue" | "dueSoon" | "normal";

/** 提醒分组：仅待办参与（逾期 / 临期 / 正常）。 */
export function homeworkReminderGroup(
  item: Homework,
  leadDays: number,
  now: Date,
): ReminderGroup {
  if (item.status !== "pending") return "normal";
  const days = calendarDaysUntil(item.dueAt, now);
  if (days < 0) return "overdue";
  if (days <= leadDays) return "dueSoon";
  return "normal";
}

export function daysUntilDue(dueAt: string, now: Date): number {
  return Math.ceil((new Date(dueAt).getTime() - now.getTime()) / 86_400_000);
}

/** 按自然日差计算剩余天数（今天=0、明天=1、昨天=-1）。 */
export function calendarDaysUntil(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startDue.getTime() - startNow.getTime()) / 86_400_000);
}

/** 按自然日差计算“已逾期 N 天”，最少为 1。 */
export function overdueDays(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round(
    (startNow.getTime() - startDue.getTime()) / 86_400_000,
  );
  return Math.max(1, diff);
}

/** 自动配色：按色板顺序选择“最少被使用”的颜色，平局取更靠前者。 */
export function autoAssignCourseColor(
  existingColors: LabelColorKey[],
  reserved: LabelColorKey[] = [],
): LabelColorKey {
  const counts = new Map<LabelColorKey, number>();
  for (const key of LABEL_COLOR_KEYS) counts.set(key, 0);
  for (const color of existingColors) {
    if (counts.has(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const reservedSet = new Set(reserved);
  let best: LabelColorKey = LABEL_COLOR_KEYS[0];
  let bestCount = Infinity;
  for (const key of LABEL_COLOR_KEYS) {
    if (reservedSet.has(key)) continue;
    const count = counts.get(key) ?? 0;
    if (count < bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (bestCount === Infinity) {
    for (const key of LABEL_COLOR_KEYS) {
      const count = counts.get(key) ?? 0;
      if (count < bestCount) {
        best = key;
        bestCount = count;
      }
    }
  }
  return best;
}

const STATUS_RANK: Record<HomeworkStatus, number> = {
  pending: 0,
  done: 1,
  archived: 2,
};

export function compareHomework(a: Homework, b: Homework): number {
  const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rankDiff !== 0) return rankDiff;
  const dueDiff = compareIds(a.dueAt, b.dueAt);
  if (dueDiff !== 0) return dueDiff;
  return compareNames(a.title, b.title);
}

export function filterHomework(
  list: Homework[],
  options: {
    status: HomeworkStatusFilter;
    courseId: "all" | "none" | string;
  },
): Homework[] {
  return list
    .filter((item) => {
      if (options.status === "all") return true;
      if (options.status === "active") {
        return item.status === "pending" || item.status === "done";
      }
      return item.status === options.status;
    })
    .filter((item) => {
      if (options.courseId === "all") return true;
      if (options.courseId === "none") return item.courseId === null;
      return item.courseId === options.courseId;
    })
    .sort(compareHomework);
}

export const DEMO_COURSES: Course[] = [
  {
    id: "c-demo-1",
    name: "高等数学",
    teacher: "王老师",
    location: "教 101",
    day: 1,
    startMin: 480,
    endMin: 580,
    weekRule: "all",
    color: "sky",
  },
  {
    id: "c-demo-2",
    name: "程序设计",
    teacher: "李老师",
    location: "机房 A",
    day: 3,
    startMin: 600,
    endMin: 700,
    weekRule: "odd",
    color: "violet",
  },
  {
    id: "c-demo-3",
    name: "线性代数",
    teacher: "张老师",
    location: "教 202",
    day: 4,
    startMin: 840,
    endMin: 940,
    weekRule: "even",
    color: "emerald",
  },
  {
    id: "c-demo-4",
    name: "大学物理",
    teacher: "赵老师",
    location: "理科楼 301",
    day: 3,
    startMin: 600,
    endMin: 700,
    weekRule: "even",
    color: "cyan",
  },
  {
    id: "c-demo-5",
    name: "数据结构与算法分析（含实验）——面向工程实践的综合课程设计",
    teacher: "李教授",
    location: "工科楼 508（实验机房 / 计算中心）",
    day: 2,
    startMin: 600,
    endMin: 700,
    weekRule: "all",
    color: "amber",
  },
];

export const DEMO_HOMEWORK: Homework[] = [
  {
    id: "h-demo-1",
    courseId: "c-demo-1",
    title: "高等数学 作业 3",
    note: "第 3 章习题 1–8，周二前交",
    details:
      "完成第 3 章习题 1–8，重点：极限与连续。\n要求写出完整推导过程，拍照或扫描后提交到课程平台。",
    dueAt: "2026-08-02T23:59:00",
    status: "pending",
  },
  {
    id: "h-demo-2",
    courseId: "c-demo-2",
    title: "程序设计 实验报告",
    note: "提交到课程平台",
    details: "",
    dueAt: "2026-08-06T18:00:00",
    status: "pending",
  },
  {
    id: "h-demo-3",
    courseId: null,
    title: "自学笔记整理",
    note: "",
    details: "",
    dueAt: "2026-08-09T12:00:00",
    status: "pending",
  },
  {
    id: "h-demo-4",
    courseId: "c-demo-3",
    title: "线性代数 习题 2",
    note: "",
    details: "",
    dueAt: "2026-08-01T23:59:00",
    status: "done",
  },
];
