import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsInfoDialog } from "./SettingsInfoDialog";
import { SETTINGS_GUIDE } from "../lib/settingsGuide";

describe("SettingsInfoDialog", () => {
  it("渲染功能介绍/情景举例/设置说明并可通过关闭按钮关闭", () => {
    const onClose = vi.fn();
    const entry = SETTINGS_GUIDE.find((item) => item.id === "watchedDirs");
    render(
      <SettingsInfoDialog open entry={entry ?? null} onClose={onClose} />,
    );
    expect(screen.getByRole("dialog", { name: "监控目录" })).toBeInTheDocument();
    expect(screen.getByText("功能介绍")).toBeInTheDocument();
    expect(screen.getByText("情景举例")).toBeInTheDocument();
    expect(screen.getByText("设置说明")).toBeInTheDocument();
    const closeButtons = screen.getAllByRole("button", { name: "关闭" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });

  it("entry 为空时关闭且不渲染内容", () => {
    render(<SettingsInfoDialog open entry={null} onClose={() => {}} />);
    expect(screen.queryByText("功能介绍")).not.toBeInTheDocument();
  });
});
