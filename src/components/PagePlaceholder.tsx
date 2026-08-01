import { useTranslation } from "react-i18next";

export function PagePlaceholder({
  titleKey,
  descriptionKey,
}: {
  titleKey: string;
  descriptionKey: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        {t(descriptionKey)}
      </p>
    </div>
  );
}
