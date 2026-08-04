import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Chip } from "./Chip";
import { Input } from "./Input";

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
      <div className="flex flex-wrap items-center gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-muted">—</span>
        ) : (
          items.map((item) => (
            <Chip
              key={item}
              size="md"
              variant="neutral"
              onRemove={() => onRemove(item)}
              removeLabel={t("settings.remove")}
            >
              {item}
            </Chip>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          size="sm"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={placeholder}
          className="flex-1"
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
