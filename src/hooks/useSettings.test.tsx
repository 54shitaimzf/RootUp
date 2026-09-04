import { act, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../lib/tauri", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  defaultSettings,
}));

function Probe() {
  const { settings, update, replace } = useSettings();
  return (
    <div>
      <span data-testid="theme">{settings?.theme}</span>
      <button onClick={() => update({ theme: "dark" })}>dark</button>
      <button onClick={() => update({ language: "en" })}>en</button>
      <button
        onClick={() =>
          replace({ ...(settings ?? defaultSettings), theme: "light" })
        }
      >
        light
      </button>
    </div>
  );
}

describe("useSettings 保存语义", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getSettings).mockResolvedValue(defaultSettings);
    vi.mocked(updateSettings).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("update 合并防抖写盘", async () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("dark"));
    fireEvent.click(screen.getByText("en"));
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark", language: "en" }),
    );
  });

  it("replace 立即写盘并取消挂起防抖", async () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("dark"));
    fireEvent.click(screen.getByText("light"));
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "light" }),
    );

    await act(async () => {
      vi.advanceTimersByTime(SETTINGS_SAVE_DEBOUNCE_MS);
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });
});
