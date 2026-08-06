import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormSection } from "./FormSection";
import { TextArea } from "./TextArea";

describe("FormSection", () => {
  it("渲染标题、描述与装饰分隔线", () => {
    const { container } = render(
      <FormSection title="基本信息" description="提示">
        内容
      </FormSection>,
    );
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
    expect(screen.getByText("内容")).toBeInTheDocument();
    const section = container.querySelector("section");
    expect(section?.className).toContain("pb-[30px]");
    expect(container.querySelector(".bg-brand-500")).not.toBeNull();
    expect(screen.getByText("基本信息").className).toContain("text-brand-700");
    const divider = container.querySelector(".form-section-divider");
    expect(divider).not.toBeNull();
    expect(divider?.className).toContain("mb-[30px]");
    expect(divider?.className).toContain("h-px");
    expect(divider?.className).toContain("bg-gradient-to-r");
  });

  it("indentContent 时内容区带引导线与缩进", () => {
    const { container } = render(
      <FormSection title="分组" indentContent>
        内容
      </FormSection>,
    );
    const content = screen.getByText("内容");
    const section = container.querySelector("section");
    expect(content.className).toContain("border-l");
    expect(content.className).toContain("border-dashed");
    expect(content.className).toContain("pl-4");
    expect(section?.className).toContain("pb-9");
    const divider = container.querySelector(".form-section-divider");
    expect(divider?.className).toContain("mb-9");
  });
});

describe("TextArea", () => {
  it("透传 rows 与 maxLength", () => {
    render(<TextArea rows={5} maxLength={100} aria-label="详情" />);
    const textarea = screen.getByLabelText("详情");
    expect(textarea).toHaveAttribute("rows", "5");
    expect(textarea).toHaveAttribute("maxlength", "100");
    expect(textarea.className).toContain("rounded-md");
  });
});
