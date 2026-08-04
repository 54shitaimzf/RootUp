/** 统一页面标题 + 描述（视觉与既有页面头部等价）。 */
export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold text-strong">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </>
  );
}
