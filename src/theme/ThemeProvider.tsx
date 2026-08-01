import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSettings } from "../hooks/useSettings";
import type { ThemeMode } from "../lib/tauri";

interface ThemeContextValue {
  theme: ThemeMode;
  /** 实际生效的主题（system 已解析为具体值） */
  resolved: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * 主题提供器：
 * - 三态（跟随系统 / 浅色 / 深色），跟随系统时监听系统变化
 * - 通过 <html class="dark"> 驱动 Tailwind 深色变体
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const theme = settings?.theme ?? "system";
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      setResolved(theme === "system" ? (media.matches ? "dark" : "light") : theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo(
    () => ({
      theme,
      resolved,
      setTheme: (mode: ThemeMode) => update({ theme: mode }),
    }),
    [theme, resolved, update],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme 必须在 ThemeProvider 内使用");
  }
  return ctx;
}
