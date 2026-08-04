import { beforeEach, describe, expect, it } from "vitest";
import {
  STUDY_STORAGE_KEY,
  copyCoursesForSemester,
  createSeedStudyData,
  defaultWeekCount,
  loadStudyData,
  saveStudyData,
  validateSemesterForm,
} from "./studyStore";
import { DEMO_COURSES, type Semester } from "./study";

describe("studyStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("种子数据完整", () => {
    const data = createSeedStudyData();
    expect(data.semesters).toHaveLength(2);
    expect(data.coursesBySemester["fall-2026"]).toHaveLength(5);
    expect(data.homeworkBySemester["fall-2026"]).toHaveLength(4);
    expect(data.coursesBySemester["spring-2027"]).toEqual([]);
    expect(data.homeworkBySemester["spring-2027"]).toEqual([]);
  });

  it("缺失或损坏回退种子，save/load 往返一致", () => {
    expect(loadStudyData().semesters[0].id).toBe("fall-2026");
    localStorage.setItem(STUDY_STORAGE_KEY, "{bad json");
    expect(loadStudyData().semesters[0].id).toBe("fall-2026");

    const data = createSeedStudyData();
    data.semesters[0].name = "自定义学期";
    saveStudyData(data);
    expect(loadStudyData().semesters[0].name).toBe("自定义学期");
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
      validateSemesterForm({ ...base, weekCount: "0" }, existing).ok,
    ).toBe(false);
    expect(
      validateSemesterForm({ ...base, weekCount: "31" }, existing).ok,
    ).toBe(false);
    expect(
      validateSemesterForm({ ...base, name: "fall 2026" }, existing).ok,
    ).toBe(false);

    const result = validateSemesterForm(
      { ...base, endDate: "2026-12-20" },
      existing,
      "a",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("Spring 2027");
      expect(result.endDate).toBe("2026-12-20");
      expect(result.weekCount).toBe(20);
    }
  });

  it("校验补充边界：同日、小数周数、空列表、编辑排除自身", () => {
    const existing: Semester[] = [
      {
        id: "a",
        name: "Fall 2026",
        startDate: "2026-08-03",
        weekCount: 20,
      },
    ];
    const base = {
      name: "Fall 2026",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      weekCount: "20",
    };
    expect(validateSemesterForm(base, existing, "a").ok).toBe(true);
    expect(
      validateSemesterForm({ ...base, weekCount: "20.5" }, existing, "a").ok,
    ).toBe(false);
    expect(validateSemesterForm({ ...base, name: "New" }, []).ok).toBe(true);
    expect(
      validateSemesterForm({ ...base, name: "fall 2026" }, existing).ok,
    ).toBe(false);
  });

  it("load 自动补齐缺失的学期桶", () => {
    const data = createSeedStudyData();
    delete data.coursesBySemester["spring-2027"];
    saveStudyData(data);
    expect(loadStudyData().coursesBySemester["spring-2027"]).toEqual([]);
  });

  it("复制空列表返回空列表", () => {
    expect(copyCoursesForSemester([])).toEqual([]);
  });

  it("结束日期早于开始时周数钳制为 1", () => {
    expect(defaultWeekCount("2026-08-10", "2026-08-03")).toBe(1);
  });

  it("复制课程生成全新 id 且字段完整", () => {
    const copied = copyCoursesForSemester(DEMO_COURSES);
    expect(copied).toHaveLength(DEMO_COURSES.length);
    expect(new Set(copied.map((course) => course.id)).size).toBe(
      copied.length,
    );
    expect(copied[0].name).toBe(DEMO_COURSES[0].name);
    expect(copied[0].startMin).toBe(DEMO_COURSES[0].startMin);
    expect(copied[0].id).not.toBe(DEMO_COURSES[0].id);
  });
});
