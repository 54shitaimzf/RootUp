import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  HelpCenterProvider,
  useHelpCenter,
} from "./HelpCenter";
import {
  ONBOARDING_STORAGE_KEY,
  isOnboardingDone,
} from "./OnboardingDialog";

vi.mock("../lib/tauri", () => ({
  listDetectedTools: vi.fn(),
  openUrl: vi.fn(),
  logEvent: vi.fn(),
}));

import { listDetectedTools, openUrl } from "../lib/tauri";

function Trigger() {
  const { openHelp } = useHelpCenter();
  return (
    <button type="button" onClick={() => openHelp("guide")}>
      open-help
    </button>
  );
}

function renderCenter() {
  return render(
    <HelpCenterProvider>
      <Trigger />
    </HelpCenterProvider>,
  );
}

describe("HelpCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    vi.mocked(listDetectedTools).mockResolvedValue(["vscode", "typora"]);
    vi.mocked(openUrl).mockResolvedValue(undefined);
  });

  it("主动入口打开帮助中心并显示新手分组", () => {
    renderCenter();
    fireEvent.click(screen.getByText("open-help"));
    expect(
      screen.getByRole("dialog", { name: "帮助与新手入门" }),
    ).toBeInTheDocument();
    expect(screen.getByText("IDE 是什么？怎么选、怎么装")).toBeInTheDocument();
  });

  it("IDE 链接调用 openUrl", async () => {
    renderCenter();
    fireEvent.click(screen.getByText("open-help"));
    const links = screen.getAllByText("VS Code");
    fireEvent.click(links[0]);
    await vi.waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith("https://code.visualstudio.com/"),
    );
  });

  it("设置说明分区按分组展示设置项说明", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.click(screen.getByRole("button", { name: "设置说明" }));
    expect(screen.getByText("监控与分类")).toBeInTheDocument();
    fireEvent.click(screen.getByText("监控与分类"));
    expect(screen.getByText("忽略规则")).toBeInTheDocument();
    expect(screen.getByText(/临时文件/)).toBeInTheDocument();
  });

  it("显示当前检测到的工具", async () => {
    renderCenter();
    fireEvent.click(screen.getByText("open-help"));
    expect(await screen.findByText("当前检测到：vscode、typora")).toBeInTheDocument();
  });

  it("未标记首次引导时自动打开欢迎弹窗并可标记完成", () => {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    renderCenter();
    expect(
      screen.getByRole("dialog", { name: "欢迎使用 RootUp" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
    expect(isOnboardingDone()).toBe(true);
  });

  it("已标记首次引导时不自动弹窗", () => {
    renderCenter();
    expect(
      screen.queryByRole("dialog", { name: "欢迎使用 RootUp" }),
    ).not.toBeInTheDocument();
  });
});
