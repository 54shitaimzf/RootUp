import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Select } from "./Select";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

function Harness({
  initial = "a",
  onChange = () => {},
  options = OPTIONS,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  options?: { value: string; label: string; disabled?: boolean }[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      options={options}
      searchable={false}
    />
  );
}

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

  it("Home/End 跳转首尾后 Enter 选中", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.keyDown(window, { key: "End" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c");
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    fireEvent.keyDown(window, { key: "Home" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("禁用选项不可被 Enter 选中", () => {
    const onChange = vi.fn();
    render(
      <Select
        value="a"
        onChange={onChange}
        searchable={false}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta", disabled: true },
          { value: "c", label: "Gamma" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("空选项时显示无匹配占位并可正常关闭", () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={[]}
        searchable={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "—" }));
    expect(screen.getByText("无匹配选项")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
