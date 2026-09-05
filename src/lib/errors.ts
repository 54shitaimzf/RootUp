/**
 * 结构化错误码约定（0.8.8 错误码注册表的最小切片）：
 * 后端需要前端分支处理的错误以 `code + 分隔符 + message` 形式返回，
 * code 为稳定标识（如 scheme.duplicate），message 为用户可读文案。
 * 前端「code 优先映射 i18n，无 code 展示 message」；
 * 禁止对 message 做子串匹配判断分支。
 */
const CODE_SEPARATOR = "|";
const CODE_SHAPE = /^[a-z][a-z0-9_.]*$/;

function splitCode(err: unknown): { code: string | null; message: string } {
  const raw = String(err);
  const sep = raw.indexOf(CODE_SEPARATOR);
  if (sep <= 0) return { code: null, message: raw };
  const code = raw.slice(0, sep);
  if (!CODE_SHAPE.test(code)) return { code: null, message: raw };
  return { code, message: raw.slice(sep + CODE_SEPARATOR.length) };
}

/** 提取结构化错误码；无码返回 null。 */
export function errorCode(err: unknown): string | null {
  return splitCode(err).code;
}

/** 展示用错误文案：剥离错误码前缀，无码原样返回。 */
export function errorMessage(err: unknown): string {
  return splitCode(err).message;
}
