import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StudyPage } from "./StudyPage";

const TODAY = new Date("2026-08-04T12:00:00");

function renderStudy() {
  return render(<StudyPage today={TODAY} />);
}

describe("StudyPage", () => {
  it("默认展示课程表与示例课程、当前周信息", () => {
    const { container } = renderStudy();
    expect(
      screen.getByRole("heading", { name: "学业" }),
    ).toBeInTheDocument();
    expect(screen.getByText("高等数学")).toBeInTheDocument();
    expect(screen.getByText("程序设计")).toBeInTheDocument();
    expect(screen.getByText("线性代数")).toBeInTheDocument();
    expect(screen.getByText("第 1 周 · 单周")).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="day-header-1"]'),
    ).toBeInTheDocument();
  });

  it("周起始日切换后周日列排在最前", () => {
    const { container } = renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "周日开头" }));
    const headers = container.querySelectorAll('[data-testid^="day-header-"]');
    expect(headers[0].getAttribute("data-testid")).toBe("day-header-7");
    expect(headers[1].getAttribute("data-testid")).toBe("day-header-1");
  });

  it("仅当前周过滤单双周课程", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "仅当前周" }));
    expect(screen.getByText("程序设计")).toBeInTheDocument();
    expect(screen.queryByText("线性代数")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部周次" }));
    expect(screen.getByText("线性代数")).toBeInTheDocument();
  });

  it("添加课程成功与校验失败", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "添加课程" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/请检查填写内容/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学英语" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("大学英语")).toBeInTheDocument();
  });

  it("点击课程卡进入编辑并保存", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /高等数学/ }));
    expect(
      screen.getByRole("heading", { name: "编辑课程" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "高等数学（进阶）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("高等数学（进阶）")).toBeInTheDocument();
  });

  it("删除课程后作业保留并变为无课程", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /线性代数/ }));
    const deleteButtons = screen.getAllByRole("button", {
      name: "删除课程",
    });
    fireEvent.click(deleteButtons[0]);
    const confirmButtons = screen.getAllByRole("button", {
      name: "删除课程",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "作业" }));
    expect(screen.getByText("线性代数 习题 2")).toBeInTheDocument();
    expect(screen.getAllByText("无课程").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "线性代数" }),
    ).not.toBeInTheDocument();
  });

  it("添加作业后出现在列表", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "作业" }));
    fireEvent.click(screen.getByRole("button", { name: "添加作业" }));
    fireEvent.change(screen.getByPlaceholderText("如：高数作业 3"), {
      target: { value: "新作业" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("新作业")).toBeInTheDocument();
  });

  it("勾选完成并可归档", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "作业" }));
    const row = screen.getByText("程序设计 实验报告").closest("li")!;
    const checkbox = within(row).getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(within(row).getByRole("button", { name: "归档" }));
    expect(within(row).getByRole("checkbox")).toBeDisabled();
  });

  it("删除作业需确认", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "作业" }));
    const row = screen.getByText("自学笔记整理").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "删除作业" }));
    const confirmButtons = screen.getAllByRole("button", {
      name: "删除作业",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(screen.queryByText("自学笔记整理")).not.toBeInTheDocument();
  });

  it("课程卡作业数跳转作业视图并筛选该课程", () => {
    renderStudy();
    const card = screen.getByRole("button", { name: /高等数学/ });
    fireEvent.click(within(card).getByRole("button", { name: "1 项作业" }));
    expect(screen.getByText("高等数学 作业 3")).toBeInTheDocument();
    expect(
      screen.queryByText("程序设计 实验报告"),
    ).not.toBeInTheDocument();
  });

  it("筛选空态提示", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "作业" }));
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    expect(screen.getByText("没有符合筛选条件的作业")).toBeInTheDocument();
  });
});
