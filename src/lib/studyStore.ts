import type { LabelDef } from "./tauri";
import {
  DEMO_COURSES,
  DEMO_HOMEWORK,
  DEMO_SEMESTERS,
  type Course,
  type Homework,
  type Semester,
} from "./study";

/** 旧 localStorage 学业数据键：仅用于一次性迁移，导入后端后删除。*/
export const LEGACY_STUDY_STORAGE_KEY = "rootup.study.data.v1";
export const SEMESTER_NAME_MAX = 40;
export const SEMESTER_WEEK_MIN = 1;
export const SEMESTER_WEEK_MAX = 30;
export const DEFAULT_WEEKS_WITHOUT_END = 20;

export interface StudyDataV1 {
  version: number;
  semesters: Semester[];
  coursesBySemester: Record<string, Course[]>;
  homeworkBySemester: Record<string, Homework[]>;
}

export type StudyData = StudyDataV1;

export type SemesterFormError =
  | "nameRequired"
  | "nameTooLong"
  | "startRequired"
  | "endBeforeStart"
  | "weekCountInvalid"
  | "duplicateName";

/** 测试/嵌入用种子夹具（运行时数据一律来自后端）。*/
export function createSeedStudyData(): StudyData {
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
    version: 1,
    semesters: DEMO_SEMESTERS.map((semester) => ({ ...semester })),
    coursesBySemester,
    homeworkBySemester,
  };
}

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T23:59:00`;
}

export const SCENARIO_SEMESTER_ID = "demo-scenarios";

function scenarioCourses(): Course[] {
  return [
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
    {
      id: "c-demo-6",
      name: "晨读英语",
      teacher: "陈老师",
      location: "外语楼 101",
      day: 2,
      startMin: 450,
      endMin: 480,
      weekRule: "all",
      color: "rose",
    },
    {
      id: "c-demo-7",
      name: "体育俱乐部",
      teacher: "刘教练",
      location: "体育馆",
      day: 6,
      startMin: 540,
      endMin: 600,
      weekRule: "all",
      color: "lime",
    },
    {
      id: "c-demo-8",
      name: "研讨课 A",
      teacher: "周老师",
      location: "研讨室 1",
      day: 5,
      startMin: 480,
      endMin: 540,
      weekRule: "range",
      weekRange: "1-2",
      color: "slate",
    },
    {
      id: "c-demo-9",
      name: "研讨课 B",
      teacher: "吴老师",
      location: "研讨室 2",
      day: 5,
      startMin: 480,
      endMin: 540,
      weekRule: "range",
      weekRange: "3-4",
      color: "blue",
    },
    {
      id: "c-demo-10",
      name: "研讨课 C",
      teacher: "郑老师",
      location: "研讨室 3",
      day: 5,
      startMin: 480,
      endMin: 540,
      weekRule: "range",
      weekRange: "5-6",
      color: "teal",
    },
  ];
}

function scenarioHomework(): Homework[] {
  return [
    {
      id: "h-demo-1",
      courseId: "c-demo-1",
      title: "高等数学 作业 3",
      note: "第 3 章习题 1–8，周二前交",
      details: "完成第 3 章习题 1–8，重点：极限与连续。\n要求写出完整推导过程。",
      dueAt: isoDaysFromNow(-2),
      status: "pending",
    },
    {
      id: "h-demo-2",
      courseId: "c-demo-2",
      title: "程序设计 实验报告",
      note: "提交到课程平台",
      details: "",
      dueAt: isoDaysFromNow(0),
      status: "pending",
    },
    {
      id: "h-demo-3",
      courseId: "c-demo-4",
      title: "大学物理 预习笔记",
      note: "",
      details: "",
      dueAt: isoDaysFromNow(1),
      status: "pending",
    },
    {
      id: "h-demo-4",
      courseId: null,
      title: "自学笔记整理",
      note: "",
      details: "",
      dueAt: isoDaysFromNow(3),
      status: "pending",
    },
    {
      id: "h-demo-5",
      courseId: "c-demo-3",
      title: "线性代数 习题 2",
      note: "",
      details: "",
      dueAt: "2026-08-01T23:59:00",
      status: "done",
    },
    {
      id: "h-demo-6",
      courseId: "c-demo-5",
      title: "数据结构 结课报告",
      note: "",
      details: "",
      dueAt: "2026-07-20T23:59:00",
      status: "archived",
    },
  ];
}

/** localStorage 迁移时并入“演示：边界场景”学期（不存在才加入，不覆盖用户数据）。*/
export function ensureDemoScenario(data: StudyData): StudyData {
  if (
    data.semesters.some((semester) => semester.id === SCENARIO_SEMESTER_ID)
  ) {
    return data;
  }
  return {
    ...data,
    semesters: [
      ...data.semesters,
      {
        id: SCENARIO_SEMESTER_ID,
        name: "演示：边界场景",
        startDate: "2026-08-03",
        endDate: "2026-12-20",
        weekCount: 20,
      },
    ],
    coursesBySemester: {
      ...data.coursesBySemester,
      [SCENARIO_SEMESTER_ID]: scenarioCourses(),
    },
    homeworkBySemester: {
      ...data.homeworkBySemester,
      [SCENARIO_SEMESTER_ID]: scenarioHomework(),
    },
  };
}

/** 课程标签 → 展示定义（文件列表/筛选/补全共用）。*/
export function buildCourseLabelDefs(data: StudyData): Record<string, LabelDef> {
  const defs: Record<string, LabelDef> = {};
  for (const courses of Object.values(data.coursesBySemester)) {
    for (const course of courses) {
      const key = course.labelKey ?? `course-${course.id}`;
      if (!key) continue;
      defs[key] = {
        key,
        name: course.name,
        icon: "book",
        color: course.color,
      };
    }
  }
  return defs;
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
