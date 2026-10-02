import type { ValueAdviceDto } from "@pointup/core/contracts";
type Warning = NonNullable<ValueAdviceDto["eligibilityWarnings"]>[number];
import Link from "next/link";

export function TransferEligibilityWarnings({ warnings }: { warnings: readonly Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-gold/30 bg-surface p-3 text-xs text-ink-muted">
      <p className="font-semibold text-gold">Some transfer routes are unavailable</p>
      <ul className="mt-1 space-y-1">
        {warnings.map(warning => <li key={`${warning.fromProviderId}-${warning.toProviderId}-${warning.code}`}>{warning.message}</li>)}
      </ul>
      <Link href="/dashboard#programs" className="mt-2 inline-block text-brand-soft underline">Open account Details to review your transfer card</Link>
    </div>
  );
}
