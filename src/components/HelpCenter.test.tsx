import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  HelpCenterProvider,
  useHelpCenter,
} from "./HelpCenter";
import {
  ONBOARDING_STORAGE_KEY,
  isOnboardingDone,
} from "./OnboardingDialog";
import { HELP_FEEDBACK_STORAGE_KEY } from "../lib/helpFeedback";

vi.mock("../lib/tauri", () => ({
  listDetectedTools: vi.fn(),
  openUrl: vi.fn(),
  logEvent: vi.fn(),
}));

import { listDetectedTools, openUrl } from "../lib/tauri";

function Trigger({ target }: { target?: string }) {
  const { openHelp } = useHelpCenter();
  return (
    <button type="button" onClick={() => openHelp(target)}>
      open-help
    </button>
  );
}

function renderCenter(onNavigate?: () => void) {
  return render(
    <HelpCenterProvider onNavigate={onNavigate}>
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

  it("任务指南分区展示文章并可展开步骤与反馈", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.click(screen.getByRole("button", { name: "任务指南" }));
    expect(screen.getByText("第一次使用 RootUp")).toBeInTheDocument();
    fireEvent.click(screen.getByText("第一次使用 RootUp"));
    expect(
      screen.getByText("打开设置，在“监控与分类”中添加要整理的文件夹。"),
    ).toBeInTheDocument();
    expect(screen.getByText("这份帮助有用吗？")).toBeInTheDocument();
  });

  it("遇到问题分区展示故障排查文章", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.click(screen.getByRole("button", { name: "遇到问题" }));
    expect(screen.getByText("添加目录后文件没出现")).toBeInTheDocument();
    expect(screen.getByText("归档后找不到文件")).toBeInTheDocument();
  });

  it("搜索命中结果并直达文章", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.change(screen.getByPlaceholderText("搜索帮助：归档、课程表、IDE…"), {
      target: { value: "归档" },
    });
    expect(screen.getByText("第一次使用 RootUp")).toBeInTheDocument();
    fireEvent.click(screen.getByText("第一次使用 RootUp"));
    expect(
      screen.getByText("打开设置，在“监控与分类”中添加要整理的文件夹。"),
    ).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText("搜索帮助：归档、课程表、IDE…") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("搜索无结果给出提示", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.change(
      screen.getByPlaceholderText("搜索帮助：归档、课程表、IDE…"),
      { target: { value: "不存在的关键词" } },
    );
    expect(
      screen.getByText("没有找到相关帮助，试试“归档”“搜索”“课程表”。"),
    ).toBeInTheDocument();
  });

  it("反馈投票写入本地记录", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.click(screen.getByRole("button", { name: "任务指南" }));
    fireEvent.click(screen.getByText("第一次使用 RootUp"));
    fireEvent.click(screen.getByRole("button", { name: "有帮助" }));
    expect(screen.getByText("已记录，谢谢反馈")).toBeInTheDocument();
    const raw = window.localStorage.getItem(HELP_FEEDBACK_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "{}")).toEqual({
      "tasks.gettingStarted": "up",
    });
  });

  it("openHelp 深链直达文章并自动展开", () => {
    render(
      <HelpCenterProvider>
        <Trigger target="tasks.files" />
      </HelpCenterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    expect(screen.getByText("搜索与整理文件")).toBeInTheDocument();
    expect(
      screen.getByText("在文件页搜索框输入文件名、路径或搜索语法。"),
    ).toBeInTheDocument();
  });

  it("更新亮点区块显示当前版本", () => {
    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    expect(screen.getByText("更新亮点（0.8.5）")).toBeInTheDocument();
    expect(screen.getByText(/搜索与筛选提速/)).toBeInTheDocument();
  });

  it("相关帮助跳转到另一篇文章", () => {
    render(
      <HelpCenterProvider>
        <Trigger target="tasks.gettingStarted" />
      </HelpCenterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    const related = screen.getByText("相关帮助").parentElement!;
    fireEvent.click(within(related).getByText("搜索与整理文件"));
    expect(
      screen.getByText("在文件页搜索框输入文件名、路径或搜索语法。"),
    ).toBeInTheDocument();
  });

  it("文章动作按钮跳转页面并关闭帮助", () => {
    const onNavigate = vi.fn();
    render(
      <HelpCenterProvider onNavigate={onNavigate}>
        <Trigger target="tasks.gettingStarted" />
      </HelpCenterProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-help" }));
    fireEvent.click(screen.getByRole("button", { name: "去设置添加文件夹" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(
      screen.queryByRole("dialog", { name: "帮助与新手入门" }),
    ).not.toBeInTheDocument();
  });
});
