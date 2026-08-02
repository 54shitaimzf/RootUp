import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

/** 通用 chip 编辑组：展示 + 删除 + 添加输入框。 */
export function ChipGroup({
  items,
  onAdd,
  onRemove,
  placeholder,
  addLabel,
}: {
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder: string;
  addLabel: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };
  return (
    <div>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
        ) : (
          items.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={t("settings.remove")}
                className="rounded p-0.5 text-slate-400 hover:text-red-500 dark:text-slate-500"
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
        />
        <button
          type="button"
          onClick={submit}
          className="shrink-0 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}
