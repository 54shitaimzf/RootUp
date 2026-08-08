export type HelpVote = "up" | "down";

export const HELP_FEEDBACK_STORAGE_KEY = "rootup.help.feedback.v1";

const VALID_VOTES = new Set<string>(["up", "down"]);

/** 读取本地反馈记录；localStorage 不可用或数据损坏时回退空对象。 */
export function loadHelpFeedback(): Record<string, HelpVote> {
  try {
    const raw = window.localStorage.getItem(HELP_FEEDBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, HelpVote> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && VALID_VOTES.has(value)) {
        result[key] = value as HelpVote;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** 记录一次投票（同一条目后投覆盖先投）；返回最新记录。 */
export function saveHelpVote(
  articleId: string,
  vote: HelpVote,
): Record<string, HelpVote> {
  const next = { ...loadHelpFeedback(), [articleId]: vote };
  try {
    window.localStorage.setItem(HELP_FEEDBACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默，不阻塞界面
  }
  return next;
}
