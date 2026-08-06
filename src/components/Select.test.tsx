import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./Select";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("Select", () => {
  it("点击打开列表，点选选项后回调并关闭", () => {
    const onChange = vi.fn();
    render(
      <Select
        value="a"
        onChange={onChange}
        options={OPTIONS}
        searchable={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Alpha" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("方向键导航后 Enter 选中", () => {
    const onChange = vi.fn();
    render(
      <Select
        value="a"
        onChange={onChange}
        options={OPTIONS}
        searchable={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("搜索框即时过滤选项", () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.change(screen.getByPlaceholderText("搜索选项…"), {
      target: { value: "bet" },
    });
    expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Gamma" })).not.toBeInTheDocument();
  });

  it("无匹配时显示空态文案", () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.change(screen.getByPlaceholderText("搜索选项…"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("无匹配选项")).toBeInTheDocument();
  });

  it("Esc 先清空过滤词，再按一次关闭", () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.change(screen.getByPlaceholderText("搜索选项…"), {
      target: { value: "b" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("外部点击关闭", () => {
    render(
      <Select
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        searchable={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("disabled 时触发按钮禁用且不可展开", () => {
    render(
      <Select
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        disabled
        searchable={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Alpha" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("选项渲染图标/色点/描述/选中勾，长文本带 title", () => {
    const { container } = render(
      <Select
        value="a"
        onChange={() => {}}
        searchable={false}
        options={[
          {
            value: "a",
            label: "数据结构与算法分析（含实验）",
            icon: <span data-testid="opt-icon">i</span>,
            dotClass: "bg-red-500",
            description: "2026-09-01 ~ 2026-12-20",
          },
          { value: "b", label: "Beta", dotClass: "bg-blue-500" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /数据结构/ }));
    const option = screen.getByRole("option", { name: /数据结构/ });
    expect(container.querySelector('[data-testid="opt-icon"]')).not.toBeNull();
    expect(option.querySelector(".bg-red-500")).not.toBeNull();
    expect(option.textContent).toContain("2026-09-01 ~ 2026-12-20");
    expect(option.querySelector(".lucide-check")).not.toBeNull();
    expect(
      option.querySelector('span[title="数据结构与算法分析（含实验）"]'),
    ).not.toBeNull();
  });

  it("searchable=false 时不渲染搜索框", () => {
    render(
      <Select
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        searchable={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.queryByPlaceholderText("搜索选项…")).not.toBeInTheDocument();
  });
});
