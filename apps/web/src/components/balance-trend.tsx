import type { BalanceTrend } from "@pointup/core";

import { formatPoints } from "@/lib/format";

function DeltaChip({
  label,
  points,
}: {
  label: string;
  points: number;
}) {
  const positive = points > 0;
  const negative = points < 0;
  const tone = positive
    ? "text-positive"
    : negative
      ? "text-danger"
      : "text-ink-faint";
  const sign = positive ? "+" : "";

  return (
    <span className={`text-xs font-medium ${tone}`}>
      {label} {sign}
      {formatPoints(points)}
    </span>
  );
}

/** Compact trend chips for account cards and the detail page. */
export function BalanceTrendChips({ trend }: { trend: BalanceTrend }) {
  const chips: { label: string; points: number }[] = [];
  if (trend.sincePrevious) {
    chips.push({ label: "vs last", points: trend.sincePrevious.points });
  }
  if (trend.since30Days) {
    chips.push({ label: "30d", points: trend.since30Days.points });
  }
  if (trend.since90Days) {
    chips.push({ label: "90d", points: trend.since90Days.points });
  }
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {chips.map((chip) => (
        <DeltaChip key={chip.label} label={chip.label} points={chip.points} />
      ))}
    </div>
  );
}
