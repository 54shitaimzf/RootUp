/**
 * 应用级事件名常量（跨语言契约的前端镜像）。
 *
 * 真源为 `fixtures/app-contracts.json`（Rust 侧 `core/events.rs` 同源断言），
 * `events.test.ts` 强制本表与 fixture 一致；emit/listen 一律引用本表，禁止裸字符串。
 * 注意：lib 层不 import 主题相关模块，保持「lib = 纯逻辑与后端契约」边界。
 */
export const APP_EVENTS = {
  scanProgress: "scan-progress",
  scanFinished: "scan-finished",
  filesChanged: "files-changed",
  settingsChanged: "settings-changed",
  closeRequested: "close-requested",
  projectOpen: "project-open",
  studyHomeworkOpen: "study-homework-open",
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];
