import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormSection } from "./FormSection";
import { TextArea } from "./TextArea";

describe("FormSection", () => {
  it("渲染标题、描述与首段样式类", () => {
    const { container } = render(
      <FormSection title="基本信息" description="提示">
        内容
      </FormSection>,
    );
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByText("提示")).toBeInTheDocument();
    expect(screen.getByText("内容")).toBeInTheDocument();
    const section = container.querySelector("section");
    expect(section?.className).toContain("pt-4");
    expect(section?.className).toContain("first:pt-0");
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
