import { useTranslation } from "react-i18next";
import { Button } from "../../../components/Button";
import { VirtualRows } from "../../../components/VirtualRows";
import type { SortDir, SortField, FileRecord } from "../../../lib/tauri";
import { FILE_ROW_HEIGHT, VIRTUAL_ROW_THRESHOLD, type LabelDefLike, type RowPresentation } from "../model";
import { FileRow, type FileRowProps } from "./FileRow";

const SORT_FIELDS: SortField[] = ["name", "type", "size", "modified", "labels"];

export interface FileListProps {
  items: FileRecord[];
  presentations: RowPresentation[];
  labelDefs: Record<string, LabelDefLike>;
  sortField: SortField | null;
  sortDir: SortDir;
  onSortToggle: (field: SortField) => void;
  batchMode: boolean;
  selected: Set<string>;
  onToggleSelect: FileRowProps["onToggleSelect"];
  archiveVisible: (file: FileRecord) => boolean;
  rowHandlers: Omit<
    FileRowProps,
    | "file"
    | "presentation"
    | "labelDefs"
    | "batchMode"
    | "selected"
    | "archiveVisible"
    | "onToggleSelect"
  >;
  offset: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
}

/**
 * 文件列表：排序头 + 行渲染（超过阈值走虚拟滚动）+ 分页 footer。
 * 0.8.7 阶段一拆出自 FilePage，DOM 结构与类名保持零回归。
 */
export function FileList({
  items,
  presentations,
  labelDefs,
  sortField,
  sortDir,
  onSortToggle,
  batchMode,
  selected,
  onToggleSelect,
  archiveVisible,
  rowHandlers,
  offset,
  pageSize,
  total,
  hasMore,
  onLoadMore,
}: FileListProps) {
  const { t } = useTranslation();
  const renderRow = (index: number) => {
    const file = items[index];
    return (
      <FileRow
        file={file}
        presentation={presentations[index]}
        labelDefs={labelDefs}
        batchMode={batchMode}
        selected={selected.has(file.path)}
        archiveVisible={archiveVisible(file)}
        onToggleSelect={onToggleSelect}
        {...rowHandlers}
      />
    );
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
        {SORT_FIELDS.map((field) => {
          const active = sortField === field;
          return (
            <button
              key={field}
              type="button"
              onClick={() => onSortToggle(field)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                active
                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {t(`files.sort${field[0].toUpperCase()}${field.slice(1)}`)}
              {active && (
                <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
              )}
            </button>
          );
        })}
      </div>
      {items.length > VIRTUAL_ROW_THRESHOLD ? (
        <VirtualRows
          total={items.length}
          rowHeight={FILE_ROW_HEIGHT}
          renderRow={renderRow}
        />
      ) : (
        <ul className="@container divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((_, index) => renderRow(index))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        <div className="flex items-center gap-3">
          <span>
            {t("files.pageInfo", {
              page: Math.floor(offset / pageSize) + 1,
            })}
          </span>
          <span>
            {total >= 0
              ? t("files.countInfo", {
                  shown: items.length,
                  total,
                })
              : t("files.countShown", { shown: items.length })}
          </span>
        </div>
        {hasMore && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onLoadMore}
          >
            {t("files.loadMore")}
          </Button>
        )}
      </div>
    </>
  );
}
