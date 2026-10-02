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
    <div className="stat-cell flex flex-col gap-2">
      <span className="text-sm font-medium text-ink-muted">
        {label}
      </span>
      <span className="font-display text-3xl font-bold text-ink">{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}
