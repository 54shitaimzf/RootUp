import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CourseFormDialog } from "./CourseFormDialog";
import { CourseScheduleView } from "./CourseScheduleView";
import { HomeworkFormDialog } from "./HomeworkFormDialog";
import { HomeworkView } from "./HomeworkView";
import { DEMO_COURSES, DEMO_HOMEWORK } from "../../lib/study";

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

  it("非指定周次时周次范围输入禁用", () => {
    render(
      <CourseFormDialog
        open
        initial={null}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText("如：2-16 或 1,3,5-8")).toBeDisabled();
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
    expect(document.querySelector(".divide-y")).not.toBeNull();
  });
});

describe("HomeworkFormDialog", () => {
  it("空标题提交显示错误", () => {
    render(
      <HomeworkFormDialog
        open
        initial={null}
        courses={DEMO_COURSES}
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
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByText("截止时间")).toBeInTheDocument();
    expect(screen.getByText("作业详情")).toBeInTheDocument();
    expect(document.querySelector(".divide-y")).not.toBeNull();
  });
});

describe("视图空态", () => {
  const commonProps = {
    weekStart: "monday" as const,
    onWeekStartChange: () => {},
    showAllWeeks: true,
    onShowAllWeeksChange: () => {},
    currentWeek: 1,
    today: new Date("2026-08-04T12:00:00"),
    onAdd: () => {},
    onEdit: () => {},
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

  it("周次徽章与今天标记使用小圆角而非胶囊", () => {
    render(
      <CourseScheduleView
        courses={[DEMO_COURSES[2]]}
        homework={[]}
        {...commonProps}
      />,
    );
    const badge = screen.getByText("双周");
    expect(badge.className).toContain("rounded-sm");
    expect(badge.className).not.toContain("rounded-full");
    const today = screen.getByText("今天");
    expect(today.className).toContain("rounded-sm");
    expect(today.className).not.toContain("rounded-full");
  });
});
