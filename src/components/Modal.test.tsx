import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";

describe("Modal", () => {
  it("渲染标题、内容与关闭按钮", () => {
    render(
      <Modal open title="测试弹窗" onClose={() => {}}>
        <p>内容区</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "测试弹窗" })).toBeInTheDocument();
    expect(screen.getByText("内容区")).toBeInTheDocument();
    expect(screen.getByLabelText("关闭")).toBeInTheDocument();
  });

  it("contentHeight 应用到内容区", () => {
    render(
      <Modal open title="固定高度" onClose={() => {}} contentHeight="h-[65vh]">
        <p>内容</p>
      </Modal>,
    );
    const scroller = screen.getByText("内容").closest("div");
    expect(scroller?.className).toContain("h-[65vh]");
  });

  it("Esc 关闭", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Esc" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭，点击面板不关闭", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open title="遮罩" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    );
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("open=false 不渲染", () => {
    render(
      <Modal open={false} title="隐藏" onClose={() => {}}>
        <p>内容</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ConfirmDialog 遵循 Windows 是左否右（确认在左、取消在右）", () => {
    render(
      <ConfirmDialog
        open
        title="确认"
        description="确定？"
        confirmLabel="确认删除"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const names = buttons.map((button) => button.textContent);
    expect(names.indexOf("确认删除")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("取消")).toBeGreaterThan(names.indexOf("确认删除"));
  });
});
