import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HelpCenterProvider } from "./HelpCenter";
import { Sidebar } from "./Sidebar";

function renderSidebar() {
  return render(
    <HelpCenterProvider>
      <Sidebar current="files" onNavigate={() => {}} />
    </HelpCenterProvider>,
  );
}

describe("Sidebar", () => {
  it("导航合并为学业，不再有作业/课程入口", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "学业" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "小工具" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作业" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "课程" })).not.toBeInTheDocument();
  });

  it("点击学业回调 study", () => {
    const onNavigate = vi.fn();
    render(
      <HelpCenterProvider>
        <Sidebar current="files" onNavigate={onNavigate} />
      </HelpCenterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "学业" }));
    expect(onNavigate).toHaveBeenCalledWith("study");
  });
});
