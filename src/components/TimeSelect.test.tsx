import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimeSelect } from "./TimeSelect";

describe("TimeSelect", () => {
  it("点击打开小时与分钟列，点分钟提交", () => {
    const onChange = vi.fn();
    render(
      <TimeSelect value="08:00" onChange={onChange} ariaLabel="开始时间" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "30" }));
    expect(onChange).toHaveBeenCalledWith("08:30");
  });

  it("±5 分钟快捷调整并钳制在 23:55", () => {
    const onChange = vi.fn();
    render(
      <TimeSelect value="08:00" onChange={onChange} ariaLabel="开始时间" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    fireEvent.click(screen.getByRole("button", { name: "+5" }));
    expect(onChange).toHaveBeenCalledWith("08:05");

    const clamp = vi.fn();
    render(
      <TimeSelect value="23:55" onChange={clamp} ariaLabel="结束时间" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "结束时间" }));
    fireEvent.click(screen.getByRole("button", { name: "+5" }));
    expect(clamp).toHaveBeenCalledWith("23:55");
  });

  it("方向键微调 5 分钟", () => {
    const onChange = vi.fn();
    render(
      <TimeSelect value="08:00" onChange={onChange} ariaLabel="开始时间" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("08:05");
  });

  it("Esc 与外部点击关闭", () => {
    render(<TimeSelect value="08:00" onChange={() => {}} ariaLabel="开始时间" />);
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("invalid 时显示红框", () => {
    render(
      <TimeSelect
        value="08:00"
        onChange={() => {}}
        invalid
        ariaLabel="结束时间"
      />,
    );
    expect(screen.getByRole("button", { name: "结束时间" }).className).toContain(
      "border-red-400",
    );
  });

  it("非法值回退到默认 08:00", () => {
    const onChange = vi.fn();
    render(
      <TimeSelect value="xx:yy" onChange={onChange} ariaLabel="开始时间" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    fireEvent.click(screen.getByRole("button", { name: "+5" }));
    expect(onChange).toHaveBeenCalledWith("08:05");
  });

  it("输入法组合期间 Esc 不关闭", () => {
    render(<TimeSelect value="08:00" onChange={() => {}} ariaLabel="开始时间" />);
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(event, "isComposing", { value: true });
    fireEvent(window, event);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
