import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StudyPage } from "./StudyPage";
import { createSeedStudyData, ensureDemoScenario } from "../lib/studyStore";
import {
  getStudyData,
  saveStudyData,
  studyStoreExists,
} from "../lib/tauri";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    getStudyData: vi.fn(async () => {
      throw new Error("should use initialData or migration path");
    }),
    saveStudyData: vi.fn(async (data: unknown) => data),
    studyStoreExists: vi.fn(async () => true),
    reapplyStudyLabels: vi.fn(async () => 0),
    logEvent: vi.fn(async () => {}),
  };
});

const TODAY = new Date("2026-08-04T12:00:00");

function renderStudy() {
  return render(<StudyPage today={TODAY} initialData={createSeedStudyData()} />);
}

describe("StudyPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("默认显示课程表与示例课程、当前周信息，主切换为等宽图标页签", () => {
    const { container } = renderStudy();
    expect(
      screen.getByRole("heading", { name: "学业" }),
    ).toBeInTheDocument();
    expect(screen.getByText("高等数学")).toBeInTheDocument();
    expect(screen.getByText("大学物理")).toBeInTheDocument();
    expect(screen.getByText("线性代数")).toBeInTheDocument();
    expect(
      screen.getByText(
        "数据结构与算法分析（含实验）——面向工程实践的综合课程设计",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("程序设计")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /共 2 门/ }));
    expect(screen.getByText("大学物理")).toBeInTheDocument();
    expect(screen.getByText("程序设计")).toBeInTheDocument();
    expect(screen.getByText("第 1 周 · 单周")).toBeInTheDocument();
    expect(
      (screen.getByLabelText("学期") as HTMLSelectElement).value,
    ).toBe("fall-2026");
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

  it("长标题课程详情显示完整名称", () => {
    renderStudy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /数据结构与算法分析/,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "课程详情" });
    expect(
      within(dialog).getByText(
        "数据结构与算法分析（含实验）——面向工程实践的综合课程设计",
      ),
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
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加课程" })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/请检查填写内容/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "大学英语" },
    });
    fireEvent.change(screen.getByLabelText("星期"), {
      target: { value: "2" },
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
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加作业" })[0],
    );
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
    expect(
      screen.queryByText("程序设计 实验报告"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    const archivedRow = screen.getByText("程序设计 实验报告").closest("li")!;
    const archivedCheckbox = within(archivedRow).getByRole("checkbox");
    expect(archivedCheckbox).toBeDisabled();
    expect(archivedCheckbox).toBeChecked();
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

  it("学期切换与当前周预览", () => {
    renderStudy();
    const select = screen.getByLabelText("学期") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "spring-2027" } });
    expect(select.value).toBe("spring-2027");
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    expect(screen.getByText("第 2 周 · 双周")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到本周" }));
    expect(screen.getByText("第 1 周 · 单周")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "回到本周" }),
    ).not.toBeInTheDocument();
  });

  it("偏好记忆：学期选择持久化", () => {
    const first = renderStudy();
    fireEvent.change(screen.getByLabelText("学期"), {
      target: { value: "spring-2027" },
    });
    first.unmount();
    renderStudy();
    expect(
      (screen.getByLabelText("学期") as HTMLSelectElement).value,
    ).toBe("spring-2027");
  });

  it("学期管理：新建并切换为空课表且自动保存", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "管理学期" }));
    fireEvent.click(screen.getByRole("button", { name: "新建学期" }));
    fireEvent.change(screen.getByLabelText("学期名称"), {
      target: { value: "2028 春季学期" },
    });
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2028-03-01" },
    });
    fireEvent.change(screen.getByLabelText("周数"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const select = screen.getByLabelText("学期") as HTMLSelectElement;
    expect(select.selectedOptions[0].text).toBe("2028 春季学期");
    expect(screen.getByText("还没有课程")).toBeInTheDocument();
    const calls = vi.mocked(saveStudyData).mock.calls;
    const lastSave = calls[calls.length - 1]?.[0] as {
      semesters: { name: string }[];
    };
    expect(
      lastSave.semesters.some((semester) => semester.name === "2028 春季学期"),
    ).toBe(true);
  });

  it("学期管理：复制学期为新课表且作业为空", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "管理学期" }));
    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("高等数学")).toBeInTheDocument();
    expect(
      (screen.getByLabelText("学期") as HTMLSelectElement).selectedOptions[0]
        .text,
    ).toContain("副本");
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    expect(screen.getByText("还没有作业")).toBeInTheDocument();
  });

  it("学期管理：删除当前学期并回退到剩余学期", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "管理学期" }));
    fireEvent.click(screen.getAllByRole("button", { name: "删除学期" })[0]);
    const confirms = screen.getAllByRole("button", {
      name: "删除学期",
    });
    fireEvent.click(confirms[confirms.length - 1]);
    expect(
      (screen.getByLabelText("学期") as HTMLSelectElement).value,
    ).toBe("spring-2027");
    expect(screen.getByText("还没有课程")).toBeInTheDocument();
  });

  it("旧 localStorage 数据迁移到后端并清除旧键", async () => {
    const legacy = createSeedStudyData();
    localStorage.setItem("rootup.study.data.v1", JSON.stringify(legacy));
    vi.mocked(studyStoreExists).mockResolvedValueOnce(false);
    const migrated = ensureDemoScenario(legacy);
    vi.mocked(getStudyData).mockResolvedValueOnce(migrated);
    render(<StudyPage today={TODAY} />);
    expect(await screen.findByText("高等数学")).toBeInTheDocument();
    expect(localStorage.getItem("rootup.study.data.v1")).toBeNull();
    expect(saveStudyData).toHaveBeenCalledWith(
      expect.objectContaining({
        semesters: expect.arrayContaining([
          expect.objectContaining({ id: "demo-scenarios" }),
        ]),
      }),
    );
  });

  it("课程与作业按学期隔离并自动保存到后端", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "管理学期" }));
    fireEvent.click(screen.getByRole("button", { name: "新建学期" }));
    fireEvent.change(screen.getByLabelText("学期名称"), {
      target: { value: "隔离测试学期" },
    });
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2028-03-01" },
    });
    fireEvent.change(screen.getByLabelText("周数"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const newId = (screen.getByLabelText("学期") as HTMLSelectElement).value;

    fireEvent.click(
      screen.getAllByRole("button", { name: "添加课程" })[0],
    );
    fireEvent.change(screen.getByPlaceholderText("如：高等数学"), {
      target: { value: "新课" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("新课")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加作业" })[0],
    );
    fireEvent.change(screen.getByPlaceholderText("如：高数作业 3"), {
      target: { value: "新作业" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("新作业")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^课程表/ }));
    fireEvent.change(screen.getByLabelText("学期"), {
      target: { value: "fall-2026" },
    });
    expect(screen.queryByText("新课")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    expect(screen.queryByText("新作业")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^课程表/ }));
    fireEvent.change(screen.getByLabelText("学期"), {
      target: { value: newId },
    });
    expect(screen.getByText("新课")).toBeInTheDocument();
    const calls = vi.mocked(saveStudyData).mock.calls;
    const lastSave = calls[calls.length - 1]?.[0] as {
      coursesBySemester: Record<string, { name: string }[]>;
    };
    expect(
      Object.values(lastSave.coursesBySemester)
        .flat()
        .some((course) => course.name === "新课"),
    ).toBe(true);
  });

  it("学期管理：编辑学期名称生效", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "管理学期" }));
    fireEvent.click(screen.getAllByRole("button", { name: "编辑学期" })[0]);
    fireEvent.change(screen.getByLabelText("学期名称"), {
      target: { value: "2026 秋季（修订）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(
      (screen.getByLabelText("学期") as HTMLSelectElement).selectedOptions[0]
        .text,
    ).toBe("2026 秋季（修订）");
  });

  it("学期管理：删除非当前学期不影响当前选择", () => {
    renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "管理学期" }));
    fireEvent.click(screen.getAllByRole("button", { name: "删除学期" })[1]);
    const confirms = screen.getAllByRole("button", {
      name: "删除学期",
    });
    fireEvent.click(confirms[confirms.length - 1]);
    expect(
      (screen.getByLabelText("学期") as HTMLSelectElement).value,
    ).toBe("fall-2026");
    expect(screen.getByText("高等数学")).toBeInTheDocument();
  });

  it("已归档作业勾选框为选中态且标题保留划线", () => {
    const data = createSeedStudyData();
    data.homeworkBySemester["fall-2026"] = [
      {
        id: "arch",
        courseId: null,
        title: "已归档作业",
        note: "",
        details: "",
        dueAt: "2026-07-01T23:59:00",
        status: "archived",
      },
    ];
    render(<StudyPage today={TODAY} initialData={data} />);
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    const row = screen.getByText("已归档作业").closest("li")!;
    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).toBeDisabled();
    expect(checkbox).toBeChecked();
    expect(within(row).getByText("已归档作业")).toHaveClass("line-through");
  });

  it("默认只显示活跃作业，已归档与全部筛选在最后", () => {
    const data = createSeedStudyData();
    data.homeworkBySemester["fall-2026"] = [
      {
        id: "p",
        courseId: null,
        title: "活跃作业",
        note: "",
        details: "",
        dueAt: "2026-08-10T23:59:00",
        status: "pending",
      },
      {
        id: "a",
        courseId: null,
        title: "归档作业",
        note: "",
        details: "",
        dueAt: "2026-07-01T23:59:00",
        status: "archived",
      },
    ];
    render(<StudyPage today={TODAY} initialData={data} />);
    fireEvent.click(screen.getByRole("button", { name: /^作业/ }));
    expect(screen.getByText("活跃作业")).toBeInTheDocument();
    expect(screen.queryByText("归档作业")).not.toBeInTheDocument();
    const chips = screen.getAllByRole("button", {
      name: /^(活跃|待办|已完成|已归档|全部)$/,
    });
    const chipNames = chips.map((chip) => chip.textContent);
    expect(chipNames[chipNames.length - 2]).toBe("已归档");
    expect(chipNames[chipNames.length - 1]).toBe("全部");
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    expect(screen.getByText("归档作业")).toBeInTheDocument();
  });
});
