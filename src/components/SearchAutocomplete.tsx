import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  applySuggestion,
  getSuggestions,
  type Suggestion,
} from "../lib/autocomplete";
import type { FilterHabits } from "../lib/filterHabits";
import { FilterIcon } from "./FilterIcon";
import { SyntaxHelp } from "./SyntaxHelp";

/**
 * 搜索框 + 自动补全（combobox）：
 * 空输入按使用习惯给出建议；↑/↓ 选择、Enter 插入、Esc 关闭、点击插入。
 */
export function SearchAutocomplete({
  query,
  onChange,
  candidates,
  habits,
  onInsert,
  limit = 8,
}: {
  query: string;
  onChange: (value: string) => void;
  candidates: Suggestion[];
  habits: FilterHabits;
  onInsert?: (suggestion: Suggestion) => void;
  limit?: number;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => getSuggestions(query, candidates, habits, limit),
    [query, candidates, habits, limit],
  );

  useEffect(() => {
    setHighlight(0);
  }, [query, suggestions.length]);

  const apply = (suggestion: Suggestion) => {
    onChange(applySuggestion(query, suggestion));
    onInsert?.(suggestion);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      apply(suggestions[highlight]);
    } else if (event.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="mt-6 flex items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("files.searchPlaceholder")}
          aria-autocomplete="list"
          aria-expanded={focused && suggestions.length > 0}
          className="w-full rounded-md border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm shadow-card outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        />
        {query && (
          <button
            type="button"
            aria-label={t("files.clearSearch")}
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="size-4" />
          </button>
        )}
        {focused && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-pop dark:border-slate-700 dark:bg-slate-900">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.kind}:${suggestion.raw}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  apply(suggestion);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  index === highlight
                    ? "bg-slate-100 dark:bg-slate-800"
                    : ""
                }`}
              >
                <SuggestionIcon suggestion={suggestion} />
                <span className="min-w-0 flex-1 truncate">{suggestion.display}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {suggestion.token}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <SyntaxHelp />
    </div>
  );
}

function SuggestionIcon({ suggestion }: { suggestion: Suggestion }) {
  return <FilterIcon kind={suggestion.kind} value={suggestion.raw} />;
}
