/**
 * 错误码注册表（0.8.8）前端镜像：真源为 fixtures/error-codes.json。
 *
 * 错误串沿用 `code|message` 结构化前缀（lib/errors.ts 的 errorCode 解析），
 * 本模块按注册表给出分级：可重试 / 可忽略 / 需用户介入；未注册码按
 * needs_user 兜底展示（与后端 core/error_codes.rs 口径一致）。
 */
import registry from "../../fixtures/error-codes.json";

export type ErrorSeverity = "retryable" | "ignorable" | "needs_user";

interface RegistryEntry {
  code: string;
  severity: ErrorSeverity;
  summary: string;
}

interface ErrorRegistry {
  severities: string[];
  codes: RegistryEntry[];
}

const parsed = registry as unknown as ErrorRegistry;

const SEVERITY_BY_CODE: ReadonlyMap<string, ErrorSeverity> = new Map(
  parsed.codes.map((entry) => [entry.code, entry.severity]),
);

/** 全部注册码（按 fixture 顺序）；供测试与门禁断言真源一致。 */
export const ERROR_CODES: readonly string[] = parsed.codes.map((entry) => entry.code);

/** 查询错误码分级；未注册返回 null。 */
export function errorSeverity(code: string): ErrorSeverity | null {
  return SEVERITY_BY_CODE.get(code) ?? null;
}

/** 展示兜底分级：未注册码视为需用户介入。 */
export function severityOrFallback(code: string): ErrorSeverity {
  return SEVERITY_BY_CODE.get(code) ?? "needs_user";
}
