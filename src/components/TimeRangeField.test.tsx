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

  it("渲染标签、连接符与两个时间输入", () => {
    render(
      <TimeRangeField
        {...base}
        onStartChange={() => {}}
        onEndChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("开始时间")).toHaveValue("08:00");
    expect(screen.getByLabelText("结束时间")).toHaveValue("09:40");
    expect(screen.getByText("至")).toBeInTheDocument();
  });

  it("变化回调传出新值", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(
      <TimeRangeField {...base} onStartChange={onStart} onEndChange={onEnd} />,
    );
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "10:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "11:30" },
    });
    expect(onStart).toHaveBeenCalledWith("10:00");
    expect(onEnd).toHaveBeenCalledWith("11:30");
  });
});
