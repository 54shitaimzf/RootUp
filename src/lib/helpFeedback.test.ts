import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HELP_FEEDBACK_STORAGE_KEY,
  loadHelpFeedback,
  saveHelpVote,
} from "./helpFeedback";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("helpFeedback", () => {
  it("无记录时返回空对象", () => {
    expect(loadHelpFeedback()).toEqual({});
  });

  it("投票后写入并可读取", () => {
    const next = saveHelpVote("tasks.files", "up");
    expect(next).toEqual({ "tasks.files": "up" });
    expect(loadHelpFeedback()).toEqual({ "tasks.files": "up" });
    expect(
      window.localStorage.getItem(HELP_FEEDBACK_STORAGE_KEY),
    ).toContain('"tasks.files":"up"');
  });

  it("同一条目后投覆盖先投", () => {
    saveHelpVote("tasks.files", "up");
    const next = saveHelpVote("tasks.files", "down");
    expect(next).toEqual({ "tasks.files": "down" });
    expect(loadHelpFeedback()).toEqual({ "tasks.files": "down" });
  });

  it("损坏 JSON 回退空对象", () => {
    window.localStorage.setItem(HELP_FEEDBACK_STORAGE_KEY, "{oops");
    expect(loadHelpFeedback()).toEqual({});
  });

  it("非对象结构与非法投票值被过滤", () => {
    window.localStorage.setItem(HELP_FEEDBACK_STORAGE_KEY, JSON.stringify([1]));
    expect(loadHelpFeedback()).toEqual({});
    window.localStorage.setItem(
      HELP_FEEDBACK_STORAGE_KEY,
      JSON.stringify({ a: "maybe", b: "up" }),
    );
    expect(loadHelpFeedback()).toEqual({ b: "up" });
  });

  it("localStorage 不可用时静默回退", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadHelpFeedback()).toEqual({});
    expect(() => saveHelpVote("a", "up")).not.toThrow();
  });
});
