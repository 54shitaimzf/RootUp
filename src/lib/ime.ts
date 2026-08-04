/**
 * 输入法组合（composition）判断。
 *
 * 中文输入法打拼音时，Enter/Escape/Tab 等按键是“组合”的一部分，
 * 应用侧键盘监听必须放行给输入法，否则会打断候选词或误触快捷键。
 * 兼容 React 合成事件（nativeEvent）与原生 KeyboardEvent。
 */
export function isComposing(
  event:
    | { nativeEvent?: { isComposing?: boolean } }
    | { isComposing?: boolean },
): boolean {
  if ("nativeEvent" in event && event.nativeEvent) {
    return Boolean(event.nativeEvent.isComposing);
  }
  return Boolean((event as { isComposing?: boolean }).isComposing);
}
