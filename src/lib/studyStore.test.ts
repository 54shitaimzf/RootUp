import { describe, expect, it } from "vitest";
import {
  SCENARIO_SEMESTER_ID,
  buildCourseLabelDefs,
  copyCoursesForSemester,
  createSeedStudyData,
  defaultWeekCount,
  ensureDemoScenario,
  validateSemesterForm,
} from "./studyStore";
import { DEMO_COURSES, type Semester } from "./study";

describe("studyStore 校验与复制", () => {
  it("种子夹具完整", () => {
    const data = createSeedStudyData();
    expect(data.semesters).toHaveLength(2);
    expect(data.coursesBySemester["fall-2026"]).toHaveLength(5);
    expect(data.homeworkBySemester["fall-2026"]).toHaveLength(4);
    expect(data.coursesBySemester["spring-2027"]).toEqual([]);
  });

  it("按日期推算周数并钳制", () => {
    expect(defaultWeekCount("2026-08-03", "2026-08-03")).toBe(1);
    expect(defaultWeekCount("2026-08-03", "2026-08-09")).toBe(1);
    expect(defaultWeekCount("2026-08-03", "2026-08-10")).toBe(2);
    expect(defaultWeekCount("2026-08-03")).toBe(20);
    expect(defaultWeekCount("2026-01-01", "2027-12-31")).toBe(30);
  });

  it("学期表单校验矩阵", () => {
    const existing: Semester[] = [
      {
        id: "a",
        name: "Fall 2026",
        startDate: "2026-08-03",
        weekCount: 20,
      },
    ];
    const base = {
      name: "Spring 2027",
      startDate: "2026-08-03",
      endDate: "",
      weekCount: "20",
    };
    expect(validateSemesterForm({ ...base, name: "" }, existing).ok).toBe(
      false,
    );
    expect(
      validateSemesterForm({ ...base, name: "x".repeat(41) }, existing).ok,
    ).toBe(false);
    expect(validateSemesterForm({ ...base, startDate: "" }, existing).ok).toBe(
      false,
    );
    expect(
      validateSemesterForm(
        { ...base, startDate: "2026-08-10", endDate: "2026-08-03" },
        existing,
      ).ok,
    ).toBe(false);
    expect(
      validateSemesterForm({ ...base, weekCount: "31" }, existing).ok,
    ).toBe(false);
    expect(
      validateSemesterForm({ ...base, name: "fall 2026" }, existing).ok,
    ).toBe(false);
    expect(
      validateSemesterForm(
        { ...base, endDate: "2026-08-03" },
        existing,
        "a",
      ).ok,
    ).toBe(true);
  });

  it("复制课程生成全新 id 且字段完整", () => {
    const copied = copyCoursesForSemester(DEMO_COURSES);
    expect(copied).toHaveLength(DEMO_COURSES.length);
    expect(new Set(copied.map((course) => course.id)).size).toBe(
      copied.length,
    );
    expect(copied[0].name).toBe(DEMO_COURSES[0].name);
    expect(copied[0].id).not.toBe(DEMO_COURSES[0].id);
  });
});

describe("演示场景与课程标签展示", () => {
  it("迁移时并入演示学期且幂等", () => {
    const data = ensureDemoScenario(createSeedStudyData());
    expect(
      data.semesters.some((semester) => semester.id === SCENARIO_SEMESTER_ID),
    ).toBe(true);
    expect(data.coursesBySemester[SCENARIO_SEMESTER_ID]).toHaveLength(10);
    expect(data.homeworkBySemester[SCENARIO_SEMESTER_ID]).toHaveLength(6);
    const again = ensureDemoScenario(data);
    expect(
      again.semesters.filter((semester) => semester.id === SCENARIO_SEMESTER_ID),
    ).toHaveLength(1);
  });

  it("课程标签映射到显示名与颜色（含无 labelKey 回退）", () => {
    const data = createSeedStudyData();
    data.coursesBySemester["fall-2026"] = [
      {
        ...DEMO_COURSES[0],
        labelKey: "course-c-demo-1",
      },
      {
        ...DEMO_COURSES[1],
        labelKey: undefined,
      },
    ];
    const defs = buildCourseLabelDefs(data);
    expect(defs["course-c-demo-1"]?.name).toBe("高等数学");
    expect(defs["course-c-demo-1"]?.color).toBe("sky");
    expect(defs[`course-${DEMO_COURSES[1].id}`]?.name).toBe("程序设计");
  });
});
