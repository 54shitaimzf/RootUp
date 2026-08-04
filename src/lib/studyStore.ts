import {
  DEMO_COURSES,
  DEMO_HOMEWORK,
  DEMO_SEMESTERS,
  type Course,
  type Homework,
  type Semester,
} from "./study";

export const STUDY_STORAGE_KEY = "rootup.study.data.v1";
export const STUDY_DATA_VERSION = 1;
export const SEMESTER_NAME_MAX = 40;
export const SEMESTER_WEEK_MIN = 1;
export const SEMESTER_WEEK_MAX = 30;
export const DEFAULT_WEEKS_WITHOUT_END = 20;

export interface StudyDataV1 {
  version: 1;
  semesters: Semester[];
  coursesBySemester: Record<string, Course[]>;
  homeworkBySemester: Record<string, Homework[]>;
}

export type SemesterFormError =
  | "nameRequired"
  | "nameTooLong"
  | "startRequired"
  | "endBeforeStart"
  | "weekCountInvalid"
  | "duplicateName";

export function createSeedStudyData(): StudyDataV1 {
  const first = DEMO_SEMESTERS[0];
  const coursesBySemester: Record<string, Course[]> = {};
  const homeworkBySemester: Record<string, Homework[]> = {};
  for (const semester of DEMO_SEMESTERS) {
    coursesBySemester[semester.id] = [];
    homeworkBySemester[semester.id] = [];
  }
  coursesBySemester[first.id] = DEMO_COURSES.map((course) => ({ ...course }));
  homeworkBySemester[first.id] = DEMO_HOMEWORK.map((homework) => ({
    ...homework,
  }));
  return {
    version: STUDY_DATA_VERSION,
    semesters: DEMO_SEMESTERS.map((semester) => ({ ...semester })),
    coursesBySemester,
    homeworkBySemester,
  };
}

function isStudyData(value: unknown): value is StudyDataV1 {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<StudyDataV1>;
  return (
    data.version === STUDY_DATA_VERSION &&
    Array.isArray(data.semesters) &&
    typeof data.coursesBySemester === "object" &&
    typeof data.homeworkBySemester === "object"
  );
}

/** 加载学业数据；缺失或损坏时回退种子并覆盖（不做备份）。*/
export function loadStudyData(): StudyDataV1 {
  try {
    const raw = localStorage.getItem(STUDY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isStudyData(parsed)) {
        for (const semester of parsed.semesters) {
          parsed.coursesBySemester[semester.id] ??= [];
          parsed.homeworkBySemester[semester.id] ??= [];
        }
        return parsed;
      }
    }
  } catch {
    // 存储不可读时回退种子
  }
  const seed = createSeedStudyData();
  saveStudyData(seed);
  return seed;
}

export function saveStudyData(data: StudyDataV1): void {
  try {
    localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 存储不可写时静默失败，不阻塞页面
  }
}

function clampWeekCount(value: number): number {
  return Math.max(SEMESTER_WEEK_MIN, Math.min(value, SEMESTER_WEEK_MAX));
}

/** 按起止日期推算周数（向下取整 +1），无结束日期时用默认 20。*/
export function defaultWeekCount(startDate: string, endDate?: string): number {
  if (!endDate) return DEFAULT_WEEKS_WITHOUT_END;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diffDays = Math.floor(
    (end.getTime() - start.getTime()) / 86_400_000,
  );
  return clampWeekCount(Math.floor(diffDays / 7) + 1);
}

export interface SemesterFormInput {
  name: string;
  startDate: string;
  endDate: string;
  weekCount: string;
}

export type SemesterFormResult =
  | {
      ok: true;
      name: string;
      startDate: string;
      endDate?: string;
      weekCount: number;
    }
  | { ok: false; error: SemesterFormError };

export function validateSemesterForm(
  input: SemesterFormInput,
  existing: Semester[],
  excludeId?: string,
): SemesterFormResult {
  const name = input.name.trim();
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  const weekCount = Number(input.weekCount);
  if (!name) return { ok: false, error: "nameRequired" };
  if (name.length > SEMESTER_NAME_MAX) {
    return { ok: false, error: "nameTooLong" };
  }
  if (!startDate) return { ok: false, error: "startRequired" };
  if (endDate && endDate < startDate) {
    return { ok: false, error: "endBeforeStart" };
  }
  if (
    !Number.isInteger(weekCount) ||
    weekCount < SEMESTER_WEEK_MIN ||
    weekCount > SEMESTER_WEEK_MAX
  ) {
    return { ok: false, error: "weekCountInvalid" };
  }
  const lower = name.toLocaleLowerCase();
  const duplicate = existing.some(
    (item) =>
      item.id !== excludeId &&
      item.name.trim().toLocaleLowerCase() === lower,
  );
  if (duplicate) return { ok: false, error: "duplicateName" };
  return {
    ok: true,
    name,
    startDate,
    endDate: endDate || undefined,
    weekCount,
  };
}

/** 复制课程作为新学期底稿：字段完整克隆，生成全新 id。*/
export function copyCoursesForSemester(courses: Course[]): Course[] {
  const now = Date.now();
  return courses.map((course, index) => ({
    ...course,
    id: `c-${now}-${index}`,
  }));
}
