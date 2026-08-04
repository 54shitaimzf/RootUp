import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CourseFormDialog } from "./CourseFormDialog";
import { HomeworkFormDialog } from "./HomeworkFormDialog";
import { DEMO_COURSES } from "../../../lib/study";

const TODAY = new Date("2026-08-04T12:00:00");

function renderCourseForm(
  props: Partial<Parameters<typeof CourseFormDialog>[0]> = {},
) {
  return render(
    <CourseFormDialog
      open
      initial={null}
      onSave={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("CourseFormDialog 智能表单", () => {
  it("名称与老师同行右对齐，地点独占一行", () => {
    renderCourseForm();
    expect(
      screen.getByLabelText("课程名称").closest(".col-span-5"),
    ).not.toBeNull();
    expect(
      screen.getByLabelText("老师").closest(".col-span-2"),
    ).not.toBeNull();
    expect(
      screen.getByLabelText("地点").closest(".col-span-2"),
    ).toBeNull();
  });

  it("课程时长快捷项按开始时间计算结束时间", () => {
    renderCourseForm();
    fireEvent.click(screen.getByRole("button", { name: "90 分钟" }));
    expect(screen.getByLabelText("结束时间")).toHaveTextContent("09:30");
  });

  it("开始晚于结束时自动调整结束时间并提示", () => {
    renderCourseForm();
    fireEvent.click(screen.getByLabelText("开始时间"));
    fireEvent.click(
      within(screen.getByTestId("time-hours")).getByRole("option", {
        name: "10",
      }),
    );
    fireEvent.click(
      within(screen.getByTestId("time-minutes")).getByRole("option", {
        name: "00",
      }),
    );
    expect(screen.getByLabelText("结束时间")).toHaveTextContent("11:40");
    expect(screen.getByText("已自动调整结束时间")).toBeInTheDocument();
  });

  it("同周重叠课程实时警告且保存被拦截", () => {
    const onSave = vi.fn();
    renderCourseForm({ existingCourses: [DEMO_COURSES[0]], onSave });
    expect(screen.getByText("与 高等数学 时间重叠")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学英语" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText("与 高等数学 时间重叠，请调整时间或周次后保存"),
    ).toBeInTheDocument();
  });

  it("自动配色避开同课时段课程的已有颜色", () => {
    const onSave = vi.fn();
    const neighbor = {
      ...DEMO_COURSES[0],
      id: "neighbor",
      weekRule: "odd" as const,
    };
    renderCourseForm({
      existingCourses: [neighbor],
      existingColors: ["sky"],
      onSave,
    });
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学物理" },
    });
    fireEvent.change(screen.getByLabelText("周次规则"), {
      target: { value: "even" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const draft = onSave.mock.calls[0][0] as { color: string };
    expect(draft.color).not.toBe("sky");
  });

  it("周次范围失焦时归一化全角与“周”字", () => {
    const onSave = vi.fn();
    renderCourseForm({ onSave });
    fireEvent.change(screen.getByLabelText("周次规则"), {
      target: { value: "range" },
    });
    const input = screen.getByPlaceholderText("如：2-16 或 1,3,5-8");
    fireEvent.change(input, { target: { value: "2－16 周" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("2-16");
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学英语" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ weekRange: "2-16" }),
    );
  });

  it("打开时自动聚焦课程名称", () => {
    renderCourseForm();
    expect(screen.getByLabelText("课程名称")).toHaveFocus();
  });

  it("空名称保存时字段红框并在底部显示错误", () => {
    renderCourseForm();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByLabelText("课程名称").className).toContain(
      "border-red-400",
    );
    expect(screen.getByText(/请检查填写内容/)).toBeInTheDocument();
  });
});

describe("HomeworkFormDialog 智能截止", () => {
  function renderHomework(
    props: Partial<Parameters<typeof HomeworkFormDialog>[0]> = {},
  ) {
    return render(
      <HomeworkFormDialog
        open
        initial={null}
        courses={DEMO_COURSES}
        today={TODAY}
        onSave={() => {}}
        onClose={() => {}}
        {...props}
      />,
    );
  }

  it("默认截止为 7 天后并自动聚焦标题", () => {
    renderHomework();
    expect(screen.getByLabelText("日期")).toHaveValue("2026-08-11");
    expect(screen.getByLabelText("作业标题")).toHaveFocus();
  });

  it("选中课程且未手动修改时建议下次上课日 23:59", () => {
    renderHomework();
    fireEvent.change(screen.getByLabelText("课程（可选）"), {
      target: { value: DEMO_COURSES[0].id },
    });
    expect(screen.getByLabelText("日期")).toHaveValue("2026-08-10");
    expect(screen.getByLabelText("时间")).toHaveTextContent("23:59");
    expect(
      screen.getByText("已按“高等数学”上课时间建议"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("日期"), {
      target: { value: "2026-08-20" },
    });
    expect(
      screen.queryByText("已按“高等数学”上课时间建议"),
    ).not.toBeInTheDocument();
  });

  it("截止时间在过去时显示逾期警告但不阻断保存", () => {
    const onSave = vi.fn();
    renderHomework({ onSave });
    fireEvent.change(screen.getByLabelText("日期"), {
      target: { value: "2026-08-01" },
    });
    expect(
      screen.getByText("截止时间已过，将显示为逾期"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：高数作业 3"), {
      target: { value: "补交作业" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dueAt: "2026-08-01T12:00:00" }),
    );
  });
});
