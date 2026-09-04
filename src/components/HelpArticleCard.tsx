import { ChevronDown } from "../theme/icons";
import { useTranslation } from "react-i18next";
import type { HelpArticle } from "../lib/helpContent";
import { HELP_ARTICLES } from "../lib/helpContent";
import type { HelpVote } from "../lib/helpFeedback";
import type { PageKey } from "../lib/nav";
import { Button } from "./Button";

/** 帮助文章卡片：标题 + 摘要，展开显示步骤、相关条目、动作与反馈。 */
export function HelpArticleCard({
  article,
  expanded,
  vote,
  onToggle,
  onOpen,
  onAction,
  onVote,
}: {
  article: HelpArticle;
  expanded: boolean;
  vote?: HelpVote;
  onToggle: () => void;
  onOpen: (articleId: string) => void;
  onAction: (page: PageKey) => void;
  onVote: (vote: HelpVote) => void;
}) {
  const { t } = useTranslation();
  const steps = t(article.stepsKey, { returnObjects: true }) as string[];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 bg-slate-50/60 px-3 py-2.5 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
      >
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-strong">
            {t(article.titleKey)}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            {t(article.summaryKey)}
          </span>
        </span>
        <ChevronDown
          className={`mt-1 size-4 shrink-0 text-muted transition-transform duration-[var(--duration-fast)] ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-slate-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <ol className="space-y-1.5">
            {steps.map((step, index) => (
              <li
                key={index}
                className="flex items-start gap-2 text-xs leading-relaxed text-secondary"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {article.related && article.related.length > 0 && (
            <div>
              <div className="text-xs font-medium text-secondary">
                {t("help.relatedTitle")}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {article.related.map((relatedId) => {
                  const related = HELP_ARTICLES.find(
                    (item) => item.id === relatedId,
                  );
                  if (!related) return null;
                  return (
                    <button
                      key={relatedId}
                      type="button"
                      onClick={() => onOpen(relatedId)}
                      className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300"
                    >
                      {t(related.titleKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {article.action && (
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onAction(article.action!.page)}
              >
                {t(article.action.labelKey)}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <span className="text-xs text-muted">
              {t("helpFeedback.title")}
            </span>
            <button
              type="button"
              onClick={() => onVote("up")}
              className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                vote === "up"
                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {t("helpFeedback.up")}
            </button>
            <button
              type="button"
              onClick={() => onVote("down")}
              className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                vote === "down"
                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {t("helpFeedback.down")}
            </button>
            {vote && (
              <span className="text-xs text-brand-600 dark:text-brand-300">
                {t("helpFeedback.saved")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
