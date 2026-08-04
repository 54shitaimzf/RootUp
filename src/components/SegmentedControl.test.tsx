import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarDays } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("渲染选项并标记选中态", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "选项 A" },
          { value: "b", label: "选项 B" },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("点击后回调新值", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("tabs 变体渲染下划线页签", () => {
    const { container } = render(
      <SegmentedControl
        variant="tabs"
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0].className).toContain("border-brand-600");
    expect(buttons[1].className).toContain("border-transparent");
    expect(container.querySelector('[role="group"]')?.className).toContain(
      "border-b",
    );
  });

  it("segmented 默认内边距放宽", () => {
    const { container } = render(
      <SegmentedControl
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    expect(container.querySelector('[role="group"]')?.className).toContain(
      "p-1",
    );
    expect(container.querySelector('[role="group"]')?.className).toContain(
      "gap-1",
    );
  });

  it("tabs 等宽模式下按钮均分且容器限宽", () => {
    const { container } = render(
      <SegmentedControl
        variant="tabs"
        equal
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].className).toContain("flex-1");
    expect(buttons[1].className).toContain("flex-1");
    expect(container.querySelector('[role="group"]')?.className).toContain(
      "w-full",
    );
    expect(container.querySelector('[role="group"]')?.className).toContain(
      "max-w-xs",
    );
  });

  it("选项支持图标与数量徽标", () => {
    const { container } = render(
      <SegmentedControl
        variant="tabs"
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "A", icon: CalendarDays, badge: 3 },
          { value: "b", label: "B", badge: 0 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("3").className).toContain("dark:bg-slate-600");
    expect(screen.getByText("3").className).toContain("dark:text-slate-100");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
