import { useEffect } from "react";

/**
 * 输入法保护：窗口失焦时主动释放活动输入框焦点。
 *
 * WebView2/Chromium 在拼音组合未结束时切走窗口，可能残留 TSF 输入状态；
 * 失焦时 blur 编辑元素可强制结束组合，避免 RootUp 干扰下一个窗口的输入法。
 * 仅影响编辑元素，且只发生在窗口失焦瞬间，正常使用无感。
 */
export function useImeGuard() {
  useEffect(() => {
    const onWindowBlur = () => {
      const el = document.activeElement;
      if (!el) return;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        el.blur();
      }
    };
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, []);
}
