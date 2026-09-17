import { useState } from "react";
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

  it("brandTitle 渲染品牌色标题与等高竖线", () => {
    const { container } = render(
      <Modal open title="品牌标题" onClose={() => {}} brandTitle>
        <p>内容</p>
      </Modal>,
    );
    const heading = screen.getByRole("heading", { name: "品牌标题" });
    expect(heading.className).toContain("text-brand-700");
    expect(heading.className).toContain("text-lg");
    const bar = container.querySelector(".bg-brand-500");
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("h-[1em]");
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

  it("输入法组合期间 Esc 不关闭", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Esc" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    );
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(event, "isComposing", { value: true });
    fireEvent(window, event);
    expect(onClose).not.toHaveBeenCalled();
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

  it("嵌套弹层：一次 Esc 只关最顶层，父弹窗不连锁关闭", () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    function Nested() {
      const [childOpen, setChildOpen] = useState(true);
      return (
        <Modal
          open
          title="父弹窗"
          onClose={() => {
            parentClose();
            setChildOpen(false);
          }}
        >
          <p>父内容</p>
          {childOpen && (
            <ConfirmDialog
              open
              title="子确认"
              description="确认？"
              confirmLabel="确认"
              onConfirm={() => setChildOpen(false)}
              onCancel={() => {
                childClose();
                setChildOpen(false);
              }}
            />
          )}
        </Modal>
      );
    }
    render(<Nested />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
    // 子弹窗关闭后，父弹窗回到栈顶，再次 Esc 才关父
    fireEvent.keyDown(window, { key: "Escape" });
    expect(parentClose).toHaveBeenCalledTimes(1);
  });

  it("打开时焦点移入面板，关闭后还原到触发元素", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "触发";
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <Modal open title="焦点" onClose={() => {}}>
        <button type="button">内部按钮</button>
      </Modal>,
    );
    const panel = screen.getByRole("dialog", { name: "焦点" });
    expect(panel).toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("Tab 在面板内循环（末元素后回到首个）", () => {
    render(
      <Modal open title="循环" onClose={() => {}}>
        <button type="button">甲</button>
        <button type="button">乙</button>
      </Modal>,
    );
    // 面板内首个可聚焦元素是标题栏关闭按钮，其后才是内容按钮
    const first = screen.getByRole("button", { name: "关闭" });
    const last = screen.getByRole("button", { name: "乙" });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});
