import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";
import { Select } from "./Select";
import { InlineNotice } from "./InlineNotice";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { SyntaxTable } from "./SyntaxTable";
import { Field } from "./Field";
import { ColorPicker } from "./ColorPicker";
import { DialogFooter } from "./DialogFooter";

describe("共享基础组件", () => {
  it("Input 渲染占位符与尺寸类", () => {
    const { container } = render(
      <Input size="sm" placeholder="测试" />,
    );
    const input = screen.getByPlaceholderText("测试");
    expect(input).toBeInTheDocument();
    expect(container.querySelector("input")?.className).toContain("text-xs");
  });

  it("Select 渲染选项", () => {
    render(
      <Select>
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("InlineNotice 三种变体渲染文本", () => {
    render(<InlineNotice variant="success">成功</InlineNotice>);
    render(<InlineNotice variant="error">失败</InlineNotice>);
    render(<InlineNotice variant="info">提示</InlineNotice>);
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
  });

  it("EmptyState 渲染标题与动作", () => {
    render(
      <EmptyState title="空" action={<button type="button">去添加</button>} />,
    );
    expect(screen.getByText("空")).toBeInTheDocument();
    expect(screen.getByText("去添加")).toBeInTheDocument();
  });

  it("PageHeader 渲染标题与描述", () => {
    render(<PageHeader title="标题" description="描述" />);
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByText("描述")).toBeInTheDocument();
  });

  it("SyntaxTable 渲染语法行", () => {
    render(<SyntaxTable />);
    expect(screen.getByText("type")).toBeInTheDocument();
    expect(screen.getByText(/按文件类型筛选/)).toBeInTheDocument();
  });

  it("Field 渲染标签与提示", () => {
    render(
      <Field label="名称" hint="选填" htmlFor="f1">
        <input id="f1" />
      </Field>,
    );
    expect(screen.getByLabelText("名称")).toBeInTheDocument();
    expect(screen.getByText("选填")).toBeInTheDocument();
  });

  it("ColorPicker 支持自动选项与色板选择", () => {
    const { container } = render(
      <ColorPicker
        value="auto"
        onChange={() => {}}
        allowAuto
        autoLabel="自动"
      />,
    );
    expect(screen.getByRole("button", { name: "自动" })).toBeInTheDocument();
    expect(container.querySelectorAll("button").length).toBeGreaterThan(1);
  });

  it("DialogFooter 渲染子元素", () => {
    render(<DialogFooter>底部</DialogFooter>);
    expect(screen.getByText("底部")).toBeInTheDocument();
  });
});
