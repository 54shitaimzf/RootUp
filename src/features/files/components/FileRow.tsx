import { useTranslation } from "react-i18next";
import {
  Archive,
  Code2,
  Copy,
  ExternalLink,
  LocateFixed,
} from "../../../theme/icons";
import { FileTypeIcon } from "../../../components/FileTypeIcon";
import { IconButton } from "../../../components/IconButton";
import { LABEL_COLORS, labelColorKey } from "../../../lib/labelDefs";
import { formatFileSize } from "../../../lib/fileUtils";
import type { FileRecord } from "../../../lib/tauri";
import type { LabelDefLike, RowPresentation } from "../model";

export interface FileRowProps {
  file: FileRecord;
  /** 由 presentRow 派生的展示信息（本组件只渲染不再派生）。 */
  presentation: RowPresentation;
  labelDefs: Record<string, LabelDefLike>;
  batchMode: boolean;
  selected: boolean;
  /** 归档按钮可见性（indexed 且已配置归档根）。 */
  archiveVisible: boolean;
  onToggleSelect: (path: string, checked: boolean) => void;
  onArchive: (path: string) => void;
  onCopyPath: (path: string) => void;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onIdeOpen: (path: string) => void;
}

/**
 * 文件列表单行（虚拟滚动与非虚拟列表共用同一渲染）。
 * 0.8.7 阶段一拆出自 FilePage，DOM 结构与类名保持零回归；
 * props 以「记录 + 展示派生」为形态，阶段二 units 类型迁移只换解析不换行。
 */
export function FileRow({
  file,
  presentation,
  labelDefs,
  batchMode,
  selected,
  archiveVisible,
  onToggleSelect,
  onArchive,
  onCopyPath,
  onOpen,
  onReveal,
  onIdeOpen,
}: FileRowProps) {
  const { t } = useTranslation();
  const {
    meta,
    iconCategory,
    sortedLabels,
    firstDef,
    firstName,
    sizeParts,
    canIdeOpen,
  } = presentation;
  return (
    <li
      className="list-enter group flex items-center gap-1.5 px-4 py-3 text-sm"
      title={file.path}
    >
      {batchMode && (
        <input
          type="checkbox"
          aria-label={t("files.selectFile")}
          checked={selected}
          onChange={(event) => onToggleSelect(file.path, event.target.checked)}
          className="size-4 shrink-0 accent-brand-600"
        />
      )}
      <FileTypeIcon category={iconCategory} title={iconCategory} />
      <span className="w-56 shrink-0">
        <span
          className="block truncate font-medium text-slate-800 dark:text-slate-100"
          title={file.name}
        >
          {file.name}
        </span>
        {sortedLabels.length > 0 && (
          <span className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {firstDef && (
                <span
                  className={`size-1.5 rounded-full ${LABEL_COLORS[labelColorKey(firstDef.color)].dot}`}
                />
              )}
              <span className="truncate" title={firstName}>
                {firstName}
              </span>
            </span>
            {sortedLabels.length > 1 && (
              <span
                className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                title={sortedLabels
                  .slice(1)
                  .map((label) =>
                    labelDefs[label]
                      ? labelDefs[label].name
                      : t(`filter.${label}`, label),
                  )
                  .join(", ")}
              >
                +{sortedLabels.length - 1}
              </span>
            )}
          </span>
        )}
      </span>
      <span
        className="ml-2 w-14 min-w-0 shrink-0 truncate text-left font-mono text-xs text-slate-400 dark:text-slate-500"
        title={file.file_type || "—"}
      >
        {file.file_type || "—"}
      </span>
      <span
        className="w-14 min-w-0 shrink-0 truncate text-left font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500"
        title={formatFileSize(file.size)}
      >
        {sizeParts.value}
        {sizeParts.unit && (
          <span className="ml-0.5 text-slate-500 dark:text-slate-400">
            {sizeParts.unit}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        {archiveVisible && (
          <IconButton
            label={t("files.archive")}
            icon={Archive}
            tone="neutral"
            size="md"
            onClick={() => onArchive(file.path)}
          />
        )}
        <IconButton
          label={t("files.copyPath")}
          icon={Copy}
          tone="neutral"
          size="md"
          onClick={() => onCopyPath(file.path)}
        />
        <IconButton
          label={t("files.openSmart")}
          icon={ExternalLink}
          tone="neutral"
          size="md"
          onClick={() => onOpen(file.path)}
        />
        <IconButton
          label={t("projects.reveal")}
          icon={LocateFixed}
          tone="neutral"
          size="md"
          onClick={() => onReveal(file.path)}
        />
        {canIdeOpen && (
          <IconButton
            label={t("projects.openIde")}
            icon={Code2}
            tone="brand"
            size="md"
            onClick={() => onIdeOpen(file.path)}
          />
        )}
      </span>
      <span className="flex w-14 min-w-0 shrink-0 items-center gap-1.5 text-left text-xs text-slate-500 dark:text-slate-400">
        <span className={`size-1.5 shrink-0 rounded-full ${meta.dotClass}`} />
        <span className="truncate" title={t(meta.labelKey)}>
          {t(meta.labelKey)}
        </span>
      </span>
    </li>
  );
}
