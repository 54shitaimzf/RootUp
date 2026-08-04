import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimeRangeField } from "./TimeRangeField";

describe("TimeRangeField", () => {
  const base = {
    startLabel: "开始时间",
    endLabel: "结束时间",
    connector: "至",
    startValue: "08:00",
    endValue: "09:40",
    startId: "course-start",
    endId: "course-end",
  };

  it("渲染标签、连接符与两个紧凑时间选择", () => {
    render(
      <TimeRangeField
        {...base}
        onStartChange={() => {}}
        onEndChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("开始时间")).toHaveTextContent("08:00");
    expect(screen.getByLabelText("结束时间")).toHaveTextContent("09:40");
    expect(screen.getByText("至")).toBeInTheDocument();
    expect(screen.getByLabelText("开始时间").className).toContain("w-28");
  });

  it("变化回调传出新值", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(
      <TimeRangeField {...base} onStartChange={onStart} onEndChange={onEnd} />,
    );
    fireEvent.click(screen.getByLabelText("开始时间"));
    fireEvent.click(screen.getByRole("option", { name: "30" }));
    expect(onStart).toHaveBeenCalledWith("08:30");

    fireEvent.click(screen.getByLabelText("结束时间"));
    fireEvent.click(screen.getByRole("option", { name: "55" }));
    expect(onEnd).toHaveBeenCalledWith("09:55");
  });

  it("字段级 invalid 红框透传", () => {
    render(
      <TimeRangeField
        {...base}
        onStartChange={() => {}}
        onEndChange={() => {}}
        endInvalid
      />,
    );
    expect(screen.getByLabelText("结束时间").className).toContain(
      "border-red-400",
    );
  });
});
