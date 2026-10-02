export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat-cell flex min-w-0 flex-col gap-1 p-5">
      <span className="text-sm font-medium text-ink-faint">
        {label}
      </span>
      <span className="font-display break-words text-3xl font-bold text-ink">{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}
