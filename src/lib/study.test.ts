import { describe, expect, it } from "vitest";
import {
  DEMO_COURSES,
  DEMO_HOMEWORK,
  DEFAULT_COURSE_DURATION,
  autoAssignCourseColor,
  axisRange,
  axisTopPercent,
  calendarDaysUntil,
  clampCourseEnd,
  compareHomework,
  courseCardDensity,
  courseConflicts,
  coursePosition,
  daysUntilDue,
  filterHomework,
  formatClock,
  formatClockRange,
  homeworkStatusTone,
  isOverdue,
  isValidWeekRange,
  jsDayToStudyDay,
  layoutDayCourses,
  minToTime,
  normalizeWeekRange,
  overdueDays,
  parseWeekRange,
  sessionActiveInWeek,
  snapToFiveMinutes,
  splitOverlaps,
  suggestDueForCourse,
  timeToMin,
  weekDaysOrder,
  weekNumberFromDate,
  weekParity,
  weeksOverlap,
} from "./study";

describe("周次规则", () => {
  it("校验指定周次格式", () => {
    expect(isValidWeekRange("2-16")).toBe(true);
    expect(isValidWeekRange("1,3,5-8")).toBe(true);
    expect(isValidWeekRange("1")).toBe(true);
    expect(isValidWeekRange("30")).toBe(true);
    expect(isValidWeekRange("1-30")).toBe(true);
    expect(isValidWeekRange("")).toBe(false);
    expect(isValidWeekRange("0")).toBe(false);
    expect(isValidWeekRange("31")).toBe(false);
    expect(isValidWeekRange("2-1")).toBe(false);
    expect(isValidWeekRange("2-")).toBe(false);
    expect(isValidWeekRange("-3")).toBe(false);
    expect(isValidWeekRange("a")).toBe(false);
    expect(isValidWeekRange("1,")).toBe(false);
    expect(isValidWeekRange("1-30-40")).toBe(false);
  });

  it("解析指定周次为集合", () => {
    expect([...parseWeekRange("2-4")!]).toEqual([2, 3, 4]);
    expect([...parseWeekRange("1,3")!]).toEqual([1, 3]);
    expect(parseWeekRange("0")).toBeNull();
  });

  it("周次与单双周判断", () => {
    expect(weekParity(1)).toBe("odd");
    expect(weekParity(2)).toBe("even");
    expect(sessionActiveInWeek("all", undefined, 3)).toBe(true);
    expect(sessionActiveInWeek("odd", undefined, 1)).toBe(true);
    expect(sessionActiveInWeek("odd", undefined, 2)).toBe(false);
    expect(sessionActiveInWeek("even", undefined, 2)).toBe(true);
    expect(sessionActiveInWeek("even", undefined, 3)).toBe(false);
    expect(sessionActiveInWeek("range", "2-4", 3)).toBe(true);
    expect(sessionActiveInWeek("range", "2-4", 5)).toBe(false);
    expect(sessionActiveInWeek("range", undefined, 2)).toBe(false);
  });

  it("从开学日期推算当前周次", () => {
    expect(weekNumberFromDate("2026-08-03", new Date("2026-08-03T12:00"))).toBe(1);
    expect(weekNumberFromDate("2026-08-03", new Date("2026-08-04T12:00"))).toBe(1);
    expect(weekNumberFromDate("2026-08-03", new Date("2026-08-10T12:00"))).toBe(2);
    expect(weekNumberFromDate("2026-08-03", new Date("2026-07-20T12:00"))).toBe(1);
  });
});

describe("课程表几何", () => {
  const base = {
    id: "c",
    name: "课程",
    teacher: "",
    location: "",
    day: 1,
    weekRule: "all" as const,
    color: "sky" as const,
  };

  it("时间轴范围自动伸缩并整点取整", () => {
    expect(axisRange([])).toEqual({ start: 480, end: 1320 });
    expect(
      axisRange([
        { startMin: 480, endMin: 580 },
        { startMin: 600, endMin: 700 },
      ]),
    ).toEqual({ start: 480, end: 720 });
    expect(
      axisRange([
        { startMin: 470, endMin: 700 },
        { startMin: 800, endMin: 1345 },
      ]),
    ).toEqual({ start: 420, end: 1380 });
  });

  it("课程定位按分钟比例计算", () => {
    const course = { ...base, day: 1, startMin: 480, endMin: 580 };
    const pos = coursePosition(course, { start: 480, end: 720 });
    expect(pos.top).toBe(0);
    expect(pos.height).toBeCloseTo(41.67, 1);
  });

  it("重叠课程均分列宽，不重叠各占整列", () => {
    const a = { ...base, id: "a", startMin: 480, endMin: 580 };
    const b = { ...base, id: "b", startMin: 500, endMin: 600 };
    const c = { ...base, id: "c", startMin: 600, endMin: 680 };
    const slots = splitOverlaps([a, b, c]);
    expect(slots.a).toEqual({ left: 0, width: 50 });
    expect(slots.b).toEqual({ left: 50, width: 50 });
    expect(slots.c).toEqual({ left: 0, width: 100 });
  });

  it("连续重叠链同一组分宽", () => {
    const a = { ...base, id: "a", startMin: 480, endMin: 600 };
    const b = { ...base, id: "b", startMin: 520, endMin: 620 };
    const c = { ...base, id: "c", startMin: 540, endMin: 560 };
    const slots = splitOverlaps([a, b, c]);
    expect(slots.a.width).toBeCloseTo(33.33, 1);
    expect(slots.b.width).toBeCloseTo(33.33, 1);
    expect(slots.c.width).toBeCloseTo(33.33, 1);
  });
});

describe("周次互斥与时段排布", () => {
  const base = {
    id: "c",
    name: "课程",
    teacher: "",
    location: "",
    day: 1,
    weekRule: "all" as const,
    color: "sky" as const,
  };

  it("weeksOverlap 覆盖全周/单双周/指定周次矩阵", () => {
    expect(weeksOverlap({ weekRule: "all" }, { weekRule: "odd" })).toBe(true);
    expect(weeksOverlap({ weekRule: "odd" }, { weekRule: "even" })).toBe(false);
    expect(weeksOverlap({ weekRule: "odd" }, { weekRule: "odd" })).toBe(true);
    expect(
      weeksOverlap(
        { weekRule: "range", weekRange: "2-4" },
        { weekRule: "range", weekRange: "3-5" },
      ),
    ).toBe(true);
    expect(
      weeksOverlap(
        { weekRule: "range", weekRange: "2-4" },
        { weekRule: "range", weekRange: "5-8" },
      ),
    ).toBe(false);
    expect(
      weeksOverlap({ weekRule: "range", weekRange: "0" }, { weekRule: "all" }),
    ).toBe(false);
  });

  it("时间不重叠的课程拆成独立排布块", () => {
    const a = { ...base, id: "a", startMin: 480, endMin: 580 };
    const b = { ...base, id: "b", startMin: 600, endMin: 700 };
    const blocks = layoutDayCourses([a, b]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].startMin).toBe(480);
    expect(blocks[1].startMin).toBe(600);
  });

  it("错周同槽课程合成一列堆叠，无冲突", () => {
    const odd = {
      ...base,
      id: "odd",
      startMin: 480,
      endMin: 580,
      weekRule: "odd" as const,
    };
    const even = {
      ...base,
      id: "even",
      startMin: 480,
      endMin: 580,
      weekRule: "even" as const,
    };
    const blocks = layoutDayCourses([odd, even]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].conflict).toBe(false);
    expect(blocks[0].columns).toHaveLength(1);
    expect(blocks[0].columns[0].courses.map((c) => c.id)).toEqual([
      "even",
      "odd",
    ]);
    expect(blocks[0].columns[0].width).toBe(100);
    expect(blocks[0].overflow).toHaveLength(0);
  });

  it("同周真重叠拆成两列并标记冲突", () => {
    const a = { ...base, id: "a", startMin: 480, endMin: 580 };
    const b = { ...base, id: "b", startMin: 500, endMin: 600 };
    const blocks = layoutDayCourses([a, b]);
    expect(blocks[0].conflict).toBe(true);
    expect(blocks[0].columns).toHaveLength(2);
    expect(blocks[0].columns[0].width).toBeCloseTo(50);
    expect(blocks[0].columns[1].width).toBeCloseTo(50);
  });

  it("三门同周重叠只显示两列，第三门进入溢出", () => {
    const a = { ...base, id: "a", startMin: 480, endMin: 580 };
    const b = { ...base, id: "b", startMin: 500, endMin: 600 };
    const c = { ...base, id: "c", startMin: 520, endMin: 620 };
    const blocks = layoutDayCourses([a, b, c]);
    expect(blocks[0].columns).toHaveLength(2);
    expect(blocks[0].overflow.map((course) => course.id)).toEqual(["c"]);
  });

  it("起止不同但周次互斥的课程仍可并入同一列", () => {
    const odd = {
      ...base,
      id: "odd",
      startMin: 480,
      endMin: 580,
      weekRule: "odd" as const,
    };
    const even = {
      ...base,
      id: "even",
      startMin: 500,
      endMin: 600,
      weekRule: "even" as const,
    };
    const blocks = layoutDayCourses([odd, even]);
    expect(blocks[0].columns).toHaveLength(1);
    expect(blocks[0].columns[0].courses).toHaveLength(2);
  });
});

describe("课程卡密度与时间轴刻度", () => {
  it("内容密度按高度分档", () => {
    expect(courseCardDensity(28)).toBe("compact");
    expect(courseCardDensity(39)).toBe("compact");
    expect(courseCardDensity(40)).toBe("standard");
    expect(courseCardDensity(63)).toBe("standard");
    expect(courseCardDensity(64)).toBe("full");
    expect(courseCardDensity(100)).toBe("full");
  });

  it("时间轴刻度百分比与网格线共用计算", () => {
    expect(axisTopPercent(480, { start: 480, end: 720 })).toBe(0);
    expect(axisTopPercent(600, { start: 480, end: 720 })).toBe(50);
    expect(axisTopPercent(720, { start: 480, end: 720 })).toBe(100);
  });
});

describe("智能时间与周次容错", () => {
  it("5 分钟取整并按 00:00–23:55 钳制", () => {
    expect(snapToFiveMinutes(0)).toBe(0);
    expect(snapToFiveMinutes(2)).toBe(0);
    expect(snapToFiveMinutes(3)).toBe(5);
    expect(snapToFiveMinutes(480)).toBe(480);
    expect(snapToFiveMinutes(1435)).toBe(1435);
    expect(snapToFiveMinutes(1440)).toBe(1435);
    expect(snapToFiveMinutes(1438)).toBe(1435);
    expect(snapToFiveMinutes(-5)).toBe(0);
  });

  it("结束时间按开始+时长计算且不跨午夜", () => {
    expect(clampCourseEnd(480, DEFAULT_COURSE_DURATION)).toBe(580);
    expect(clampCourseEnd(1380, 100)).toBe(1435);
    expect(clampCourseEnd(480, 45)).toBe(525);
  });

  it("周次范围全角/空格/“周”字归一化", () => {
    expect(normalizeWeekRange("2－16 周")).toBe("2-16");
    expect(normalizeWeekRange("1、3、5-8")).toBe("1,3,5-8");
    expect(normalizeWeekRange("１，３")).toBe("1,3");
    expect(normalizeWeekRange("2 周")).toBe("2");
    expect(normalizeWeekRange("2-16")).toBe("2-16");
    expect(normalizeWeekRange("abc")).toBe("abc");
  });
});

describe("课程冲突与作业状态色", () => {
  const base = {
    id: "c",
    name: "课程",
    teacher: "",
    location: "",
    day: 1,
    startMin: 480,
    endMin: 580,
    weekRule: "all" as const,
    color: "sky" as const,
  };

  it("同星期重叠且周次相交才判为冲突", () => {
    const other = { ...base, id: "other" };
    expect(courseConflicts(base, [other])).toHaveLength(1);
    expect(
      courseConflicts(
        { ...base, weekRule: "odd" as const },
        [{ ...other, weekRule: "even" as const }],
      ),
    ).toHaveLength(0);
    expect(
      courseConflicts(base, [{ ...other, day: 2 }]),
    ).toHaveLength(0);
    expect(
      courseConflicts(base, [{ ...other, startMin: 600, endMin: 700 }]),
    ).toHaveLength(0);
  });

  it("编辑时排除自身", () => {
    const draft = { ...base, day: 1, startMin: 500, endMin: 600 };
    expect(courseConflicts(draft, [base, { ...base, id: "x" }], "c")).toEqual([
      expect.objectContaining({ id: "x" }),
    ]);
  });

  it("作业状态色按状态与逾期区分", () => {
    const now = new Date("2026-08-04T12:00:00");
    expect(homeworkStatusTone("pending", "2026-08-06T18:00:00", now)).toBe(
      "pending",
    );
    expect(homeworkStatusTone("pending", "2026-08-02T23:59:00", now)).toBe(
      "overdue",
    );
    expect(homeworkStatusTone("done", "2026-08-01T00:00:00", now)).toBe(
      "done",
    );
    expect(homeworkStatusTone("archived", "2026-08-01T00:00:00", now)).toBe(
      "archived",
    );
  });
});

describe("按课程时间建议截止", () => {
  it("本周尚未开课则取本周上课日", () => {
    const course = { day: 3, weekRule: "all" as const };
    expect(
      suggestDueForCourse(course, new Date("2026-08-04T12:00:00")),
    ).toBe("2026-08-05");
  });

  it("本周上课日已过则顺延到下周匹配周次", () => {
    expect(
      suggestDueForCourse(
        { day: 1, weekRule: "all" as const },
        new Date("2026-08-04T12:00:00"),
      ),
    ).toBe("2026-08-10");
    expect(
      suggestDueForCourse(
        { day: 1, weekRule: "odd" as const },
        new Date("2026-08-04T12:00:00"),
      ),
    ).toBe("2026-08-17");
  });

  it("学期内找不到匹配周次时回退 7 天后", () => {
    expect(
      suggestDueForCourse(
        { day: 1, weekRule: "range" as const, weekRange: "1-4" },
        new Date("2026-09-02T12:00:00"),
      ),
    ).toBe("2026-09-09");
  });
});

describe("时间格式", () => {
  it("中文 24 小时制 / English 12 小时制", () => {
    expect(formatClock(480, "zh-CN")).toBe("08:00");
    expect(formatClock(1320, "zh-CN")).toBe("22:00");
    expect(formatClock(0, "zh-CN")).toBe("00:00");
    expect(formatClock(480, "en")).toBe("8:00 AM");
    expect(formatClock(720, "en")).toBe("12:00 PM");
    expect(formatClock(780, "en")).toBe("1:00 PM");
    expect(formatClock(0, "en")).toBe("12:00 AM");
    expect(formatClockRange(480, 580, "zh-CN")).toBe("08:00–09:40");
  });

  it("时间输入转换", () => {
    expect(timeToMin("08:00")).toBe(480);
    expect(timeToMin("8:05")).toBe(485);
    expect(timeToMin("24:00")).toBeNull();
    expect(timeToMin("8:5")).toBeNull();
    expect(timeToMin("abc")).toBeNull();
    expect(minToTime(480)).toBe("08:00");
    expect(minToTime(485)).toBe("08:05");
  });

  it("周起始日与 JS 星期换算", () => {
    expect(jsDayToStudyDay(0)).toBe(7);
    expect(jsDayToStudyDay(1)).toBe(1);
    expect(weekDaysOrder("monday")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekDaysOrder("sunday")).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });
});

describe("自动配色", () => {
  it("空列表返回色板第一个颜色", () => {
    expect(autoAssignCourseColor([])).toBe("slate");
  });

  it("优先选择未被使用的颜色", () => {
    expect(autoAssignCourseColor(["slate", "sky"])).toBe("violet");
  });

  it("全部使用过时选择使用最少的颜色", () => {
    const all = [
      "slate", "slate", "sky", "violet", "rose", "amber",
      "orange", "emerald", "blue", "teal", "lime", "cyan", "fuchsia",
    ] as const;
    expect(autoAssignCourseColor([...all])).toBe("sky");
  });
});

describe("作业时间文案数据", () => {
  it("逾期天数按自然日计算且最少为 1", () => {
    const now = new Date("2026-08-04T12:00:00");
    expect(overdueDays("2026-08-02T23:59:00", now)).toBe(2);
    expect(overdueDays("2026-08-04T09:00:00", now)).toBe(1);
    expect(overdueDays("2026-08-03T23:00:00", now)).toBe(1);
    expect(overdueDays("2026-08-01T00:00:00", now)).toBe(3);
  });

  it("剩余天数按自然日差计算", () => {
    const now = new Date("2026-08-04T12:00:00");
    expect(calendarDaysUntil("2026-08-06T18:00:00", now)).toBe(2);
    expect(calendarDaysUntil("2026-08-05T09:00:00", now)).toBe(1);
    expect(calendarDaysUntil("2026-08-04T09:00:00", now)).toBe(0);
    expect(calendarDaysUntil("2026-08-03T23:00:00", now)).toBe(-1);
  });
});

describe("作业排序与筛选", () => {
  const pendingSoon = {
    id: "a",
    courseId: null,
    title: "A",
    note: "",
    details: "",
    dueAt: "2026-08-06T18:00:00",
    status: "pending" as const,
  };
  const pendingLate = {
    ...pendingSoon,
    id: "b",
    title: "B",
    dueAt: "2026-08-09T12:00:00",
  };
  const done = {
    ...pendingSoon,
    id: "c",
    courseId: "c1",
    title: "C",
    status: "done" as const,
  };
  const archived = {
    ...pendingSoon,
    id: "d",
    courseId: "c1",
    title: "D",
    status: "archived" as const,
  };

  it("待办优先且按截止升序，已完成/已归档在后", () => {
    const sorted = [archived, done, pendingLate, pendingSoon].sort(
      compareHomework,
    );
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("按状态与课程筛选（含无课程）", () => {
    const list = [
      pendingSoon,
      { ...pendingLate, courseId: "c1" },
      done,
      archived,
    ];
    expect(filterHomework(list, { status: "done", courseId: "all" })).toHaveLength(1);
    expect(filterHomework(list, { status: "all", courseId: "c1" }).map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(filterHomework(list, { status: "all", courseId: "none" }).map((x) => x.id)).toEqual(["a"]);
    expect(filterHomework(list, { status: "all", courseId: "all" })).toHaveLength(4);
  });

  it("逾期与剩余天数", () => {
    const now = new Date("2026-08-04T12:00:00");
    const past = { ...pendingSoon, dueAt: "2026-08-02T23:59:00" };
    expect(isOverdue(past, now)).toBe(true);
    expect(isOverdue(pendingSoon, now)).toBe(false);
    expect(isOverdue({ ...done, dueAt: "2026-08-01T00:00:00" }, now)).toBe(false);
    expect(daysUntilDue("2026-08-05T12:00:00", now)).toBe(1);
    expect(daysUntilDue("2026-08-03T11:00:00", now)).toBe(-1);
  });
});

describe("示例数据", () => {
  it("示例课程与作业完整且关联一致", () => {
    expect(DEMO_COURSES).toHaveLength(3);
    expect(DEMO_HOMEWORK).toHaveLength(4);
    const courseIds = new Set(DEMO_COURSES.map((course) => course.id));
    for (const item of DEMO_HOMEWORK) {
      if (item.courseId !== null) {
        expect(courseIds.has(item.courseId)).toBe(true);
      }
    }
  });
});
