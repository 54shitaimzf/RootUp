import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SemesterManageDialog } from "./SemesterManageDialog";
import { DEMO_SEMESTERS } from "../../lib/study";

const counts = { "fall-2026": 5, "spring-2027": 0 };

function renderDialog(
  props: Partial<Parameters<typeof SemesterManageDialog>[0]> = {},
) {
  return render(
    <SemesterManageDialog
      open
      semesters={DEMO_SEMESTERS}
      courseCounts={counts}
      onSave={() => {}}
      onDelete={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("SemesterManageDialog", () => {
  it("列表展示学期与操作", () => {
    renderDialog();
    expect(screen.getByText("2026 秋季学期")).toBeInTheDocument();
    expect(screen.getByText(/5 门课程/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "编辑学期" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "复制" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "删除学期" }).length,
    ).toBeGreaterThan(0);
  });

  it("空表单保存提示错误", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "新建学期" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请输入学期名称")).toBeInTheDocument();
  });

  it("合法表单调用 onSave 并关闭弹窗", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSave, onClose });
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
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "2028 春季学期", weekCount: 20 }),
      undefined,
      undefined,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("复制预填副本名称并携带源学期", () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
    expect(screen.getByLabelText("学期名称")).toHaveValue(
      "2026 秋季学期（副本）",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "2026 秋季学期（副本）" }),
      undefined,
      "fall-2026",
    );
  });

  it("删除需确认", () => {
    const onDelete = vi.fn();
    renderDialog({ onDelete });
    fireEvent.click(screen.getAllByRole("button", { name: "删除学期" })[0]);
    expect(
      screen.getByText(/确认删除学期“2026 秋季学期”/),
    ).toBeInTheDocument();
    const confirms = screen.getAllByRole("button", {
      name: "删除学期",
    });
    fireEvent.click(confirms[confirms.length - 1]);
    expect(onDelete).toHaveBeenCalledWith("fall-2026");
  });

  it("编辑预填并携带编辑 id", () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.click(screen.getAllByRole("button", { name: "编辑学期" })[0]);
    expect(screen.getByLabelText("学期名称")).toHaveValue("2026 秋季学期");
    fireEvent.change(screen.getByLabelText("学期名称"), {
      target: { value: "2026 秋季（修订）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "2026 秋季（修订）" }),
      "fall-2026",
      undefined,
    );
  });

  it("复制第二个学期预填其日期与周数", () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[1]);
    expect(screen.getByLabelText("学期名称")).toHaveValue(
      "2027 春季学期（副本）",
    );
    expect(screen.getByLabelText("开始日期")).toHaveValue("2027-03-01");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "2027 春季学期（副本）" }),
      undefined,
      "spring-2027",
    );
  });

  it("结束早于开始与周数越界提示对应错误", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "新建学期" }));
    fireEvent.change(screen.getByLabelText("学期名称"), {
      target: { value: "测试学期" },
    });
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(screen.getByLabelText(/结束日期/), {
      target: { value: "2026-08-03" },
    });
    fireEvent.change(screen.getByLabelText("周数"), {
      target: { value: "31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(
      screen.getByText("结束日期不能早于开始日期"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/结束日期/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("周数需为 1–30 的整数")).toBeInTheDocument();
  });

  it("删除取消不调用 onDelete", () => {
    const onDelete = vi.fn();
    renderDialog({ onDelete });
    fireEvent.click(screen.getAllByRole("button", { name: "删除学期" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "取消" })[0]);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
