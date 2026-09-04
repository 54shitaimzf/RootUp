import { describe, expect, it } from "vitest";
import appContractsFixture from "../../fixtures/app-contracts.json";
import { APP_EVENTS } from "./events";
import { fileStateMeta, FILTER_STATE_OPTIONS } from "./fileUtils";
import { FILE_STATES, type FileState } from "./tauri";

describe("跨语言契约 fixture（app-contracts.json）", () => {
  it("APP_EVENTS 与 fixture events 一一对应", () => {
    const fixtureEvents = appContractsFixture.events as Record<string, string>;
    expect(Object.keys(APP_EVENTS).sort()).toEqual(Object.keys(fixtureEvents).sort());
    for (const [key, value] of Object.entries(fixtureEvents)) {
      expect(APP_EVENTS[key as keyof typeof APP_EVENTS]).toBe(value);
    }
  });

  it("FILE_STATES 覆盖 fixture fileStates 且顺序一致", () => {
    expect(FILE_STATES).toEqual(appContractsFixture.fileStates);
  });

  it("fileStateMeta 覆盖全部状态；FILTER_STATE_OPTIONS 为其子集", () => {
    for (const state of FILE_STATES) {
      expect(fileStateMeta(state).labelKey).toBeTruthy();
    }
    for (const option of FILTER_STATE_OPTIONS) {
      expect(FILE_STATES).toContain(option);
    }
  });

  it("FileState 联合类型与 FILE_STATES 一致（编译期收口）", () => {
    const all: FileState[] = [...FILE_STATES];
    expect(all).toHaveLength(FILE_STATES.length);
  });
});
