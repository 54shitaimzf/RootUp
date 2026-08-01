import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFiles } from "../hooks/useFiles";
import {
  fileStateMeta,
  filterFiles,
  formatFileSize,
  formatTimestamp,
} from "../lib/fileUtils";

export function FilePage() {
  const { t } = useTranslation();
  const { files, loading } = useFiles();
  const [query, setQuery] = useState("");
  const visible = filterFiles(files, query);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">{t("pages.files.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t("pages.files.description")}
      </p>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("files.searchPlaceholder")}
        className="mt-6 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-card outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
      />

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("files.loading")}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("files.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((file) => {
              const meta = fileStateMeta(file.state);
              return (
                <li
                  key={file.path}
                  className="flex items-center gap-3 px-5 py-3 text-sm"
                  title={file.path}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800 dark:text-slate-100">
                      {file.name}
                    </span>
                    <span className="block truncate text-xs text-slate-400 dark:text-slate-500">
                      {file.path}
                    </span>
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500 sm:block">
                    {file.file_type || "—"}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500 sm:block">
                    {formatFileSize(file.size)}
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500 md:block">
                    {formatTimestamp(file.modified)}
                  </span>
                  <span className="flex w-20 shrink-0 items-center justify-end gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className={`size-1.5 rounded-full ${meta.dotClass}`} />
                    {t(meta.labelKey)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
