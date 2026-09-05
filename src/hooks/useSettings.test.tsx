import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_SAVE_DEBOUNCE_MS,
  SettingsProvider,
  useSettings,
} from "./useSettings";
import { getSettings, updateSettings, type Settings } from "../lib/tauri";

const { defaultSettings } = vi.hoisted(() => ({
  defaultSettings: {
    version: 3,
    theme: "system",
    language: "zh-CN",
    watched_dirs: [],
    ignore_rules: { extensions: [], prefixes: [], exact_names: [] },
    classify_overrides: [],
    project_dirs: [],
    preferred_ide: "auto",
    custom_open_commands: [],
    archive_root: "",
    auto_archive: false,
    close_action: "ask",
    reminder_enabled: false,
    reminder_lead_days: 3,
  } satisfies Settings,
}));

const listenHandlers: Array<(payload: unknown) => void> = [];

vi.mock("../lib/tauri", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  logEvent: vi.fn(),
  defaultSettings,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      _name: string,
      handler: (payload: unknown) => void,
    ): Promise<() => void> => {
      listenHandlers.push(handler);
      return Promise.resolve(() => {});
    },
  ),
}));

import { logEvent } from "../lib/tauri";

function Probe() {
  const { settings, update, commit, mergeLocal, syncFromBackend } =
    useSettings();
  return (
    <div>
      <span data-testid="theme">{settings?.theme}</span>
      <span data-testid="language">{settings?.language}</span>
      <button onClick={() => update({ theme: "dark" })}>dark</button>
      <button onClick={() => update({ language: "en" })}>en</button>
      <button
        onClick={() => {
          void commit({ theme: "light" });
        }}
      >
        light
      </button>
      <button onClick={() => mergeLocal({ watched_dirs: ["C:/Echo"] })}>
        echo
      </button>
      <button
        onClick={() =>
          syncFromBackend({
            ...defaultSettings,
            theme: "dark",
            language: "en",
          })
        }
      >
        sync
      </button>
    </div>
  );
}

function renderProbe() {
  render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>,
  );
  return act(async () => {
    await Promise.resolve();
  });
}

describe("useSettings 保存语义", () => {
  beforeEach(() => {
    listenHandlers.length = 0;
    vi.useFakeTimers();
    vi.mocked(getSettings).mockResolvedValue(defaultSettings);
    vi.mocked(updateSettings).mockResolvedValue(undefined);
    vi.mocked(logEvent).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("update 合并补丁并防抖落盘，只发变更字段", async () => {
    await renderProbe();

    fireEvent.click(screen.getByText("dark"));
    fireEvent.click(screen.getByText("en"));
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    // 只发补丁，不发整包
    expect(updateSettings).toHaveBeenCalledWith({
      theme: "dark",
      language: "en",
    });
  });

  it("commit 立即落盘并吸收挂起补丁", async () => {
    await renderProbe();

    fireEvent.click(screen.getByText("dark"));
    fireEvent.click(screen.getByText("light"));
    // commit 立即写盘，吸收挂起的 dark（同为 theme 字段被 light 覆盖）
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({ theme: "light" });

    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("flush 失败回填挂起补丁，下次事件冲刷重试", async () => {
    vi.mocked(updateSettings).mockRejectedValueOnce(new Error("write failed"));
    await renderProbe();

    fireEvent.click(screen.getByText("dark"));
    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });
    // 首次落盘失败：已记日志，补丁回填待重试
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("设置防抖落盘失败"),
    );

    // 触发一次新变更并到期：flush 把回填的旧补丁与新字段合并重发
    fireEvent.click(screen.getByText("en"));
    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });
    expect(updateSettings).toHaveBeenCalledTimes(2);
    expect(updateSettings).toHaveBeenLastCalledWith({
      theme: "dark",
      language: "en",
    });
  });

  it("settings-changed 先冲刷挂起补丁再拉取真源，不丢未落盘修改", async () => {
    vi.useRealTimers();
    await renderProbe();
    expect(listenHandlers.length).toBe(1);

    // 挂起一个未落盘补丁（不推进防抖计时器）
    fireEvent.click(screen.getByText("dark"));

    // 后端（托盘）改了语言并广播
    vi.mocked(getSettings).mockResolvedValue({
      ...defaultSettings,
      theme: "system",
      language: "en",
    });
    await act(async () => {
      listenHandlers[0]({ payload: { keys: ["language"] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // 防抖计时被 flush 取消：补丁在事件刷新前置发送，且只发变更字段
    expect(updateSettings).toHaveBeenCalledWith({ theme: "dark" });
    // 刷新以后端真源为准：托盘的语言修改不丢
    await waitFor(() =>
      expect(screen.getByTestId("language")).toHaveTextContent("en"),
    );
  });

  it("事件刷新失败重试一次，仍失败记日志并保留旧值", async () => {
    vi.useRealTimers();
    await renderProbe();

    vi.mocked(getSettings).mockRejectedValueOnce(new Error("ipc down"));
    vi.mocked(getSettings).mockResolvedValue({
      ...defaultSettings,
      theme: "dark",
    });
    await act(async () => {
      listenHandlers[0]({ payload: { keys: ["theme"] } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("theme")).toHaveTextContent("dark"),
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("syncFromBackend 只改内存不落盘", async () => {
    await renderProbe();

    fireEvent.click(screen.getByText("sync"));
    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS + 10);
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("mergeLocal 只回显内存，不进入持久化补丁通道", async () => {
    await renderProbe();

    fireEvent.click(screen.getByText("echo"));
    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS + 10);
    });
    expect(updateSettings).not.toHaveBeenCalled();
    // 随后 commit 只发自身字段，不吸收 mergeLocal 的回显
    fireEvent.click(screen.getByText("light"));
    expect(updateSettings).toHaveBeenCalledWith({ theme: "light" });
  });
});
