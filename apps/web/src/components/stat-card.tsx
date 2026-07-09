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
    <div className="card-surface flex flex-col gap-1 p-5">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <span className="font-display text-3xl font-bold text-ink">{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}
