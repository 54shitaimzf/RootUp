/** 目录输入即时校验（与后端 core::path::validate_dir_path 对齐的轻量镜像）。 */

export interface DirValidationResult {
  ok: boolean;
  value: string;
  error?: string;
}

export const MAX_DIR_LEN = 260;

const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function validateDirInput(input: string): DirValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, value: "", error: "目录不能为空" };
  }
  if (trimmed.length > MAX_DIR_LEN) {
    return { ok: false, value: "", error: "路径过长" };
  }
  let normalized = trimmed.replace(/\\/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (/[\u0000-\u001f"<>|?*]/.test(normalized)) {
    return { ok: false, value: "", error: "路径包含非法字符" };
  }
  for (const part of normalized.split("/").filter(Boolean)) {
    const base = part.split(".")[0]?.toUpperCase() ?? "";
    if (RESERVED_NAMES.has(base)) {
      return { ok: false, value: "", error: `路径包含保留名: ${part}` };
    }
    if (part.endsWith(".") || part.endsWith(" ")) {
      return {
        ok: false,
        value: "",
        error: "路径组件不能以点或空格结尾",
      };
    }
  }
  if (/^[A-Za-z]:\/?$/.test(normalized) || normalized === "/") {
    return { ok: false, value: "", error: "不能监控磁盘根目录" };
  }
  return { ok: true, value: normalized };
}
