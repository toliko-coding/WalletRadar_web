export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/50 px-6 py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{description}</div>
    </div>
  );
}
