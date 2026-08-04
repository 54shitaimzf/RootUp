import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StudyPage } from "./StudyPage";

const TODAY = new Date("2026-08-04T12:00:00");

function renderStudy() {
  return render(<StudyPage today={TODAY} />);
}

describe("StudyPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("默认显示课程表与示例课程、当前周信息，主切换为等宽图标页签", () => {
    const { container } = renderStudy();
    expect(
      screen.getByRole("heading", { name: "学业" }),
    ).toBeInTheDocument();
    expect(screen.getByText("高等数学")).toBeInTheDocument();
    expect(screen.getByText("大学英语")).toBeInTheDocument();
    expect(screen.getByText("程序设计")).toBeInTheDocument();
    expect(screen.getByText("线性代数")).toBeInTheDocument();
    expect(screen.getByText("第 1 周 · 单周")).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="day-header-1"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".lucide-calendar-days"),
    ).not.toBeNull();
    expect(
      container.querySelector(".lucide-clipboard-list"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /^课程表/ }).className,
    ).toContain("flex-1");
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

  it("点击课程卡进入详情，再从详情进入编辑并保存", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /高等数学/ }));
    expect(
      screen.getByRole("heading", { name: "课程详情" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "编辑课程" }),
    ).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "课程详情" });
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑" }));
    expect(
      screen.getByRole("heading", { name: "编辑课程" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "高等数学（进阶）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("高等数学（进阶）")).toBeInTheDocument();
  });

  it("课程详情展示完整信息与作业列表", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /高等数学/ }));
    const dialog = screen.getByRole("dialog", { name: "课程详情" });
    expect(within(dialog).getByText("王老师")).toBeInTheDocument();
    expect(within(dialog).getByText("教 101")).toBeInTheDocument();
    expect(within(dialog).getByText("周一")).toBeInTheDocument();
    expect(within(dialog).getByText("08:00–09:40")).toBeInTheDocument();
    expect(within(dialog).getByText("全周")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "课程作业" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("高等数学 作业 3")).toBeInTheDocument();
    expect(within(dialog).getByText("已逾期")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "查看该课作业" }),
    ).toBeNull();
  });

  it("课程详情作业行可点击并自动展开详情", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /高等数学/ }));
    const dialog = screen.getByRole("dialog", { name: "课程详情" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /高等数学 作业 3/ }),
    );
    expect(screen.getByText("高等数学 作业 3")).toBeInTheDocument();
    expect(screen.getByText(/要求写出完整推导过程/)).toBeInTheDocument();
    expect(
      screen.queryByText("程序设计 实验报告"),
    ).not.toBeInTheDocument();
  });

  it("删除课程后作业保留并变为无课程", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /线性代数/ }));
    const dialog = screen.getByRole("dialog", { name: "课程详情" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "删除课程" }),
    );
    const confirmButtons = screen.getAllByRole("button", {
      name: "删除课程",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    expect(screen.getByText("线性代数 习题 2")).toBeInTheDocument();
    expect(screen.getAllByText("无课程").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /线性代数/ }),
    ).not.toBeInTheDocument();
  });

  it("作业页签显示待办数量并在完成后更新", () => {
    renderStudy();
    const tab = screen.getByRole("button", { name: /^作业/ });
    expect(within(tab).getByText("3")).toBeInTheDocument();
    fireEvent.click(tab);
    const row = screen.getByText("程序设计 实验报告").closest("li")!;
    fireEvent.click(within(row).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "标记完成" }));
    expect(
      within(screen.getByRole("button", { name: /^作业/ })).getByText("2"),
    ).toBeInTheDocument();
  });

  it("添加作业后出现在列表", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    fireEvent.click(screen.getByRole("button", { name: "添加作业" }));
    fireEvent.change(screen.getByPlaceholderText("如：高数作业 3"), {
      target: { value: "新作业" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("新作业")).toBeInTheDocument();
  });

  it("勾选完成需确认，确认后可归档", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    const row = screen.getByText("程序设计 实验报告").closest("li")!;
    const checkbox = within(row).getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(
      screen.getByText("确认将“程序设计 实验报告”标记为已完成？"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标记完成" }));
    expect(checkbox).toBeChecked();
    fireEvent.click(within(row).getByRole("button", { name: "归档" }));
    expect(within(row).getByRole("checkbox")).toBeDisabled();
  });

  it("恢复待办直接生效且不弹确认", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    const row = screen.getByText("线性代数 习题 2").closest("li")!;
    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(
      screen.queryByText(/标记为已完成/),
    ).not.toBeInTheDocument();
  });

  it("详情可展开显示完整内容", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    const row = screen.getByText("高等数学 作业 3").closest("li")!;
    expect(
      within(row).queryByText(/完整推导过程/),
    ).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "查看详情" }));
    expect(
      within(row).getByText(/要求写出完整推导过程/),
    ).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "收起详情" }));
    expect(
      within(row).queryByText(/要求写出完整推导过程/),
    ).not.toBeInTheDocument();
  });

  it("截止文案显示逾期天数与剩余天数", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    expect(
      screen.getByText(/已逾期 2 天 · 2026-08-02 23:59/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 天后截止 · 2026-08-06 18:00/),
    ).toBeInTheDocument();
  });

  it("删除作业需确认", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    expect(screen.getByText("没有符合筛选条件的作业")).toBeInTheDocument();
  });

  it("偏好记忆：视图与周起始日写入并在下次渲染恢复", () => {
    const first = renderStudy();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    fireEvent.click(screen.getByRole("button", { name: /^课程表/ }));
    fireEvent.click(screen.getByRole("button", { name: "周日开头" }));
    first.unmount();
    renderStudy();
    expect(
      screen.getByRole("button", { name: /^课程表/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "周日开头" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("偏好数据损坏时回退默认", () => {
    localStorage.setItem("rootup.study.prefs.v1", "{bad json");
    renderStudy();
    expect(
      screen.getByRole("button", { name: /^课程表/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
