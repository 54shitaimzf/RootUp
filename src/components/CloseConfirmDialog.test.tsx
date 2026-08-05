import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CloseConfirmDialog } from "./CloseConfirmDialog";

const mocks = vi.hoisted(() => ({
  updateMock: vi.fn(),
  closeHandler: undefined as (() => void) | undefined,
}));

vi.mock("../lib/tauri", () => ({
  hideToTray: vi.fn(async () => {}),
  quitApp: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    mocks.closeHandler = handler;
    return () => {};
  }),
}));

import { hideToTray, quitApp } from "../lib/tauri";

describe("CloseConfirmDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeHandler = undefined;
  });

  async function openDialog() {
    render(<CloseConfirmDialog onRemember={mocks.updateMock} />);
    await act(async () => {
      mocks.closeHandler?.();
    });
  }

  it("勾选记住选择后点击后台运行会写回 close_action", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "后台运行" }));
    expect(mocks.updateMock).toHaveBeenCalledWith("background");
    expect(hideToTray).toHaveBeenCalled();
  });

  it("不勾选时只执行本次动作，不写回设置", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "退出程序" }));
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(quitApp).toHaveBeenCalled();
  });
});
