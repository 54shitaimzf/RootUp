import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Terminal, X } from "lucide-react";
import {
  addTag,
  getSuggestions,
  habitKeyForTag,
  removeLastTag,
  removeTag,
  resolveInsertion,
  type FilterTags,
  type Suggestion,
  type TagValue,
} from "../lib/autocomplete";
import { fileStateMeta } from "../lib/fileUtils";
import type { FilterHabits } from "../lib/filterHabits";
import type { FileRecord } from "../lib/tauri";
import { Chip } from "./Chip";
import { FilterIcon } from "./FilterIcon";
import { IconButton } from "./IconButton";
import { SyntaxHelp } from "./SyntaxHelp";

/**
 * 搜索框（简化版 token 输入）：
 * 已选离散条件显示为带 × 的标签，与筛选行同源；
 * 自动补全：Tab 补全、Enter 提交、↑/↓ 选择、Esc 关闭、点击应用；
 * 关键词→值两段式，size/before/after 保留文本语法。
 */
export function SearchAutocomplete({
  text,
  types,
  states,
  labels,
  candidates,
  habits,
  onTextChange,
  onTagsChange,
  onInsert,
  onHabitUsed,
  onTagAdd,
  onTagRemove,
  limit = 8,
}: {
  text: string;
  types: string[];
  states: string[];
  labels: string[];
  candidates: Suggestion[];
  habits: FilterHabits;
  onTextChange: (value: string) => void;
  onTagsChange: (tags: FilterTags) => void;
  onInsert?: (suggestion: Suggestion) => void;
  onHabitUsed?: (key: string) => void;
  onTagAdd?: (tag: TagValue) => void;
  onTagRemove?: (tag: TagValue) => void;
  limit?: number;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [caret, setCaret] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => getSuggestions(text, candidates, habits, limit),
    [text, candidates, habits, limit],
  );

  useEffect(() => {
    setHighlight(0);
  }, [text, suggestions.length]);

  const syncCaret = () => {
    setCaret(inputRef.current?.selectionStart ?? text.length);
  };

  const apply = (suggestion: Suggestion) => {
    const result = resolveInsertion(text, caret, suggestion);
    onTextChange(result.text);
    setCaret(result.caret);
    onInsert?.(suggestion);
    if (result.tag) {
      const { tags: next, added } = addTag(
        { types, states, labels },
        result.tag,
      );
      if (added) {
        onTagsChange(next);
        onTagAdd?.(result.tag);
        onHabitUsed?.(habitKeyForTag(result.tag));
      }
    }
    inputRef.current?.focus();
  };

  const handleTagRemove = (tag: TagValue) => {
    onTagsChange(removeTag({ types, states, labels }, tag));
    onTagRemove?.(tag);
  };

  const handleBackspace = () => {
    if (text !== "" || (types.length === 0 && states.length === 0 && labels.length === 0)) {
      return;
    }
    const { tags: next, removed } = removeLastTag({ types, states, labels });
    if (removed) {
      onTagsChange(next);
      onTagRemove?.(removed);
    }
  };

  const handleClear = () => {
    onTextChange("");
    onTagsChange({ types: [], states: [], labels: [] });
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      handleBackspace();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions.length > 0) {
        apply(suggestions[highlight]);
      } else {
        setFocused(false);
      }
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Tab") {
      event.preventDefault();
      apply(suggestions[highlight]);
    } else if (event.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  const tags: TagValue[] = [
    ...types.map((value) => ({ kind: "category" as const, value })),
    ...states.map((value) => ({ kind: "state" as const, value })),
    ...labels.map((value) => ({ kind: "label" as const, value })),
  ];

  const tagDisplay = (tag: TagValue) => {
    if (tag.kind === "category") return t(`filter.${tag.value}`);
    if (tag.kind === "state") {
      return t(fileStateMeta(tag.value as FileRecord["state"]).labelKey);
    }
    return tag.value;
  };

  return (
    <div className="mt-6">
      <div
        className="relative min-w-0 flex-1"
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white py-1.5 pl-2 pr-16 text-sm shadow-card transition-colors focus-within:border-brand-500 dark:border-slate-700 dark:bg-slate-900">
          {tags.map((tag) => (
            <Chip
              key={`${tag.kind}:${tag.value}`}
              size="sm"
              variant="brand"
              icon={<FilterIcon kind={tag.kind} value={tag.value} />}
              onRemove={() => handleTagRemove(tag)}
              removeLabel={t("files.removeFilter")}
            >
              {tagDisplay(tag)}
            </Chip>
          ))}
          <input
            ref={inputRef}
            type="search"
            value={text}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onChange={(event) => {
              onTextChange(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={syncCaret}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onKeyDown={handleKeyDown}
            placeholder={t("files.searchPlaceholder")}
            aria-autocomplete="list"
            aria-expanded={focused && suggestions.length > 0}
            className="min-w-24 flex-1 border-none bg-transparent px-1 py-0.5 text-sm outline-none"
          />
        </div>
        {(text !== "" || tags.length > 0) && (
          <IconButton
            label={t("files.clearSearch")}
            icon={X}
            tone="neutral"
            size="md"
            onClick={handleClear}
            className="absolute right-8 top-1/2 z-10 -translate-y-1/2"
          />
        )}
        <SyntaxHelp className="absolute inset-y-1 right-1 z-10 flex items-center" />
        {focused && suggestions.length > 0 && (
          <div className="floating-panel pop-in absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto py-1">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.key}
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
                {suggestion.kind === "keyword" ? (
                  <Terminal className="size-3.5 shrink-0 text-slate-400" />
                ) : (
                  <FilterIcon
                    kind={suggestion.kind}
                    value={suggestion.raw}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {suggestion.display}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {suggestion.token}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
