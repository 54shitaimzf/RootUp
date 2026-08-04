import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CourseFormDialog } from "./CourseFormDialog";
import { CourseScheduleView } from "./CourseScheduleView";
import { HomeworkFormDialog } from "./HomeworkFormDialog";
import { HomeworkView } from "./HomeworkView";
import {
  DEMO_COURSES,
  DEMO_HOMEWORK,
  DEMO_SEMESTERS,
} from "../../../lib/study";

describe("CourseFormDialog", () => {
  it("空名称提交显示错误且不保存", () => {
    const onSave = vi.fn();
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/请检查填写内容/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("填写后保存为课程草稿", () => {
    const onSave = vi.fn();
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学英语" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "大学英语",
        day: 1,
        startMin: 480,
        endMin: 580,
        weekRule: "all",
      }),
    );
  });

  it("新建默认自动配色，按最少使用解析具体颜色", () => {
    const onSave = vi.fn();
    render(
      <CourseFormDialog
        open
        initial={null}
        existingColors={["slate", "sky"]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学英语" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ color: "violet" }),
    );
  });

  it("非指定周次时不渲染周次范围输入，指定后出现", () => {
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(
      screen.queryByPlaceholderText("如：2-16 或 1,3,5-8"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("周次规则"), {
      target: { value: "range" },
    });
    expect(
      screen.getByPlaceholderText("如：2-16 或 1,3,5-8"),
    ).toBeInTheDocument();
  });

  it("时间对包含“至”连接符", () => {
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("至")).toBeInTheDocument();
  });

  it("指定周次非法时提示错误", () => {
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("周次规则"), {
      target: { value: "range" },
    });
    fireEvent.change(screen.getByPlaceholderText("如：2-16 或 1,3,5-8"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/请检查填写内容/)).toBeInTheDocument();
  });

  it("使用分隔线分区渲染三个区块", () => {
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByText("时间与周次")).toBeInTheDocument();
    expect(screen.getByText("颜色")).toBeInTheDocument();
    expect(document.querySelector(".divide-y")).toBeNull();
    expect(document.querySelector("section.border-t")).not.toBeNull();
  });
});

describe("HomeworkFormDialog", () => {
  it("空标题提交显示错误", () => {
    render(
      <HomeworkFormDialog
        open
        initial={null}
        courses={DEMO_COURSES}
        today={new Date("2026-08-04T12:00:00")}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/请检查填写内容/)).toBeInTheDocument();
  });

  it("保存无课程作业草稿", () => {
    const onSave = vi.fn();
    render(
      <HomeworkFormDialog
        open
        initial={null}
        courses={DEMO_COURSES}
        today={new Date("2026-08-04T12:00:00")}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("如：高数作业 3"), {
      target: { value: "新作业" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "新作业",
        courseId: null,
        status: "pending",
      }),
    );
  });

  it("备注与详情字段带长度上限", () => {
    render(
      <HomeworkFormDialog
        open
        initial={null}
        courses={DEMO_COURSES}
        today={new Date("2026-08-04T12:00:00")}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText("备注")).toHaveAttribute("maxlength", "200");
    expect(screen.getByLabelText("详情")).toHaveAttribute("maxlength", "5000");
  });

  it("使用分隔线分区渲染三个区块", () => {
    render(
      <HomeworkFormDialog
        open
        initial={null}
        courses={DEMO_COURSES}
        today={new Date("2026-08-04T12:00:00")}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByText("截止时间")).toBeInTheDocument();
    expect(screen.getByText("作业详情")).toBeInTheDocument();
    expect(document.querySelector(".divide-y")).toBeNull();
    expect(document.querySelector("section.border-t")).not.toBeNull();
  });
});

describe("视图空态", () => {
  const commonProps = {
    semesters: DEMO_SEMESTERS,
    semester: DEMO_SEMESTERS[0],
    onSemesterChange: () => {},
    onManageSemesters: () => {},
    weekStart: "monday" as const,
    onWeekStartChange: () => {},
    showAllWeeks: true,
    onShowAllWeeksChange: () => {},
    currentWeek: 1,
    actualWeek: 1,
    onWeekChange: () => {},
    onResetWeek: () => {},
    today: new Date("2026-08-04T12:00:00"),
    onAdd: () => {},
    onOpenDetail: () => {},
    onOpenCourseHomework: () => {},
  };

  it("课程表空数据提示添加课程", () => {
    render(
      <CourseScheduleView
        courses={[]}
        homework={[]}
        {...commonProps}
      />,
    );
    expect(screen.getByText("还没有课程")).toBeInTheDocument();
  });

  it("仅当前周且无匹配课程时提示", () => {
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[2]]}
        homework={[]}
        {...commonProps}
        showAllWeeks={false}
      />,
    );
    expect(screen.getByText("当前周次没有课程")).toBeInTheDocument();
  });

  it("作业空数据与筛选空态", () => {
    render(
      <HomeworkView
        homework={[]}
        courses={DEMO_COURSES}
        courseFilter="all"
        onCourseFilterChange={() => {}}
        today={new Date("2026-08-04T12:00:00")}
        onAdd={() => {}}
        onEdit={() => {}}
        onToggleStatus={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("还没有作业")).toBeInTheDocument();
  });

  it("筛选无结果时提示", () => {
    render(
      <HomeworkView
        homework={DEMO_HOMEWORK}
        courses={DEMO_COURSES}
        courseFilter="all"
        onCourseFilterChange={() => {}}
        today={new Date("2026-08-04T12:00:00")}
        onAdd={() => {}}
        onEdit={() => {}}
        onToggleStatus={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    expect(screen.getByText("没有符合筛选条件的作业")).toBeInTheDocument();
  });

  it("筛选分组显示状态与课程小标题", () => {
    render(
      <HomeworkView
        homework={DEMO_HOMEWORK}
        courses={DEMO_COURSES}
        courseFilter="all"
        onCourseFilterChange={() => {}}
        today={new Date("2026-08-04T12:00:00")}
        onAdd={() => {}}
        onEdit={() => {}}
        onToggleStatus={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("状态")).toBeInTheDocument();
    expect(screen.getByText("课程")).toBeInTheDocument();
  });

  it("课程表容器无圆角且课程卡收敛为最小圆角", () => {
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[0]]}
        homework={[]}
        {...commonProps}
      />,
    );
    expect(document.querySelector(".rounded-xl")).toBeNull();
    const card = screen
      .getByText("高等数学")
      .closest('[role="button"]') as HTMLElement;
    expect(card.className).toContain("rounded-sm");
    expect(card.className).not.toContain("rounded-md");
    expect(card.className).not.toContain("rounded-lg");
  });

  it("周次徽章与今天标记使用最小圆角而非胶囊", () => {
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[2]]}
        homework={[]}
        {...commonProps}
      />,
    );
    const badge = screen.getByText("双周");
    expect(badge.className).toContain("rounded-xs");
    expect(badge.className).not.toContain("rounded-full");
    const today = screen.getByText("今天");
    expect(today.className).toContain("rounded-xs");
    expect(today.className).not.toContain("rounded-full");
  });

  it("时间刻度与表体对齐且表头不再有内部空列", () => {
    const { container } = render(
      <CourseScheduleView
        courses={[DEMO_COURSES[0]]}
        homework={[]}
        {...commonProps}
      />,
    );
    const axis = container.querySelector('[data-testid="time-axis"]');
    expect(axis).not.toBeNull();
    expect(within(axis as HTMLElement).getByText("08:00")).toBeInTheDocument();
    const header = container.querySelector(
      '[data-testid="schedule-header"]',
    ) as HTMLElement;
    const firstHeaderCell = header.firstElementChild as HTMLElement;
    expect(firstHeaderCell.getAttribute("data-testid")).toBe("day-header-1");
  });

  it("错周同槽课程折叠为堆叠卡，点击浮层展开", () => {
    const odd = {
      ...DEMO_COURSES[0],
      id: "odd",
      weekRule: "odd" as const,
    };
    const even = {
      ...DEMO_COURSES[0],
      id: "even",
      weekRule: "even" as const,
    };
    const onOpenDetail = vi.fn();
    render(
      <CourseScheduleView
        courses={[odd, even]}
        homework={[]}
        {...commonProps}
        onOpenDetail={onOpenDetail}
      />,
    );
    const stack = screen.getByRole("button", { name: /共 2 门/ });
    expect(screen.getByText("单周")).toBeInTheDocument();
    expect(screen.queryByText("双周")).not.toBeInTheDocument();
    expect(stack).toHaveAttribute("aria-expanded", "false");
    expect(stack.className).not.toContain("overflow-hidden");
    expect(stack.style.zIndex).toBe("");
    expect(stack.querySelectorAll('[data-testid="stack-edge"]')).toHaveLength(
      1,
    );
    expect(stack.querySelector(".lucide-layers")).not.toBeNull();
    expect(within(stack).getByText("2")).toBeInTheDocument();
    fireEvent.click(stack);
    expect(screen.queryByTestId("course-stack-odd")).not.toBeInTheDocument();
    const evenCard = screen.getByTestId("spread-card-even");
    const oddCard = screen.getByTestId("spread-card-odd");
    expect(evenCard.className).toContain("fixed");
    expect(within(evenCard).getByText("双周")).toBeInTheDocument();
    expect(within(oddCard).getByText("单周")).toBeInTheDocument();
    expect(within(evenCard).getByText(/王老师/)).toBeInTheDocument();
    expect(within(evenCard).getByText(/教 101/)).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { name: /高等数学/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "even" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("spread-card-even")).not.toBeInTheDocument();
    expect(screen.getByTestId("course-stack-odd")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /共 2 门/ }));
    fireEvent.click(
      document.querySelector(".fixed.inset-0.z-40") as HTMLElement,
    );
    expect(screen.queryByTestId("spread-card-odd")).not.toBeInTheDocument();
  });

  it("长标题课程卡在课表中截断", () => {
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[4]]}
        homework={[]}
        {...commonProps}
      />,
    );
    const name = screen.getByText(DEMO_COURSES[4].name);
    expect(name.className).toContain("line-clamp-2");
  });

  it("铺开浮层显示完整信息且长标题悬浮全文", () => {
    const onOpenDetail = vi.fn();
    const odd = {
      ...DEMO_COURSES[4],
      id: "odd",
      weekRule: "odd" as const,
    };
    const even = {
      ...DEMO_COURSES[4],
      id: "even",
      weekRule: "even" as const,
    };
    render(
      <CourseScheduleView
        courses={[odd, even]}
        homework={[]}
        {...commonProps}
        onOpenDetail={onOpenDetail}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /共 2 门/ }));
    const cards = [
      screen.getByTestId("spread-card-even"),
      screen.getByTestId("spread-card-odd"),
    ];
    expect(cards).toHaveLength(2);
    expect(
      within(cards[0]).getByText(DEMO_COURSES[4].name),
    ).toBeInTheDocument();
    expect(within(cards[0]).getByText(/李教授/)).toBeInTheDocument();
    expect(
      within(cards[0]).getByText(/工科楼 508/),
    ).toBeInTheDocument();
    fireEvent.click(cards[0]);
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "even" }),
    );
  });

  it("三门同槽错周课程全部铺开", () => {
    const courses = [
      {
        ...DEMO_COURSES[0],
        id: "r1",
        name: "课程一",
        weekRule: "range" as const,
        weekRange: "1-2",
      },
      {
        ...DEMO_COURSES[0],
        id: "r2",
        name: "课程二",
        weekRule: "range" as const,
        weekRange: "3-4",
      },
      {
        ...DEMO_COURSES[0],
        id: "r3",
        name: "课程三",
        weekRule: "range" as const,
        weekRange: "5-6",
      },
    ];
    render(
      <CourseScheduleView
        courses={courses}
        homework={[]}
        {...commonProps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /共 3 门/ }));
    expect(screen.getByTestId("spread-card-r1")).toBeInTheDocument();
    expect(screen.getByTestId("spread-card-r2")).toBeInTheDocument();
    expect(screen.getByTestId("spread-card-r3")).toBeInTheDocument();
  });

  it("超过四门时只铺开四张并用 +N 收口", () => {
    const courses = [1, 2, 3, 4, 5].map((index) => ({
      ...DEMO_COURSES[0],
      id: `r${index}`,
      name: `课程${index}`,
      weekRule: "range" as const,
      weekRange: `${index * 2 - 1}-${index * 2}`,
    }));
    render(
      <CourseScheduleView
        courses={courses}
        homework={[]}
        {...commonProps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /共 5 门/ }));
    expect(screen.getByTestId("spread-card-r1")).toBeInTheDocument();
    expect(screen.getByTestId("spread-card-r4")).toBeInTheDocument();
    expect(screen.queryByTestId("spread-card-r5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+1 门" }));
    const dialog = screen.getByRole("dialog", { name: "该时段课程" });
    expect(within(dialog).getByText("课程5")).toBeInTheDocument();
  });

  it("四门同周重叠只显示两列并折叠为 +N", () => {
    const base = {
      ...DEMO_COURSES[0],
      teacher: "",
      location: "",
    };
    const courses = [0, 1, 2, 3].map((index) => ({
      ...base,
      id: `c-${index}`,
      name: `课程${index + 1}`,
      startMin: 480 + index * 20,
      endMin: 580 + index * 20,
    }));
    render(
      <CourseScheduleView
        courses={courses}
        homework={[]}
        {...commonProps}
      />,
    );
    expect(screen.getByRole("button", { name: "+2 门" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+2 门" }));
    expect(
      screen.getByRole("heading", { name: "该时段课程" }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "该时段课程" });
    expect(within(dialog).getByText("课程1")).toBeInTheDocument();
    expect(within(dialog).getByText("课程4")).toBeInTheDocument();
  });

  it("短课时卡片使用紧凑密度，长课时使用完整密度", () => {
    const short = {
      ...DEMO_COURSES[0],
      id: "short",
      startMin: 480,
      endMin: 510,
    };
    render(
      <CourseScheduleView
        courses={[short, DEMO_COURSES[0]]}
        homework={[]}
        {...commonProps}
      />,
    );
    expect(screen.getByTestId("course-card-short")).toHaveAttribute(
      "data-density",
      "compact",
    );
    expect(screen.getByTestId("course-card-c-demo-1")).toHaveAttribute(
      "data-density",
      "full",
    );
  });

  it("学期选择与周步进回调", () => {
    const onSemesterChange = vi.fn();
    const onWeekChange = vi.fn();
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[0]]}
        homework={[]}
        {...commonProps}
        onSemesterChange={onSemesterChange}
        onWeekChange={onWeekChange}
      />,
    );
    const select = screen.getByLabelText("学期") as HTMLSelectElement;
    expect(select.value).toBe("fall-2026");
    fireEvent.change(select, { target: { value: "spring-2027" } });
    expect(onSemesterChange).toHaveBeenCalledWith("spring-2027");
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    expect(onWeekChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    expect(onWeekChange).toHaveBeenCalledWith(1);
  });

  it("当前周不等于实际周时显示回到本周", () => {
    const onResetWeek = vi.fn();
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[0]]}
        homework={[]}
        {...commonProps}
        currentWeek={3}
        actualWeek={1}
        onResetWeek={onResetWeek}
      />,
    );
    expect(screen.getByText("第 3 周 · 单周")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到本周" }));
    expect(onResetWeek).toHaveBeenCalled();
    expect(
      screen.getByText("2026-08-03 ~ 2026-12-20 · 共 20 周"),
    ).toBeInTheDocument();
  });

  it("工具栏显示学期管理入口与普通学期名", () => {
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[0]]}
        homework={[]}
        {...commonProps}
      />,
    );
    expect(screen.getByRole("button", { name: "管理学期" })).toBeInTheDocument();
    expect(screen.getByText("2026 秋季学期")).toBeInTheDocument();
  });
});
