import { findCardProduct } from "@pointup/core/card-products";
import type { PlanRedemptionResultDto, RedemptionPlanDto } from "@pointup/core/contracts";

import { TransferEligibilityWarnings } from "@/components/transfer-eligibility-warnings";
import { formatPoints, formatUsdFromCents } from "@/lib/format";

/**
 * "Best ways to use your points": the top optimizer plans for the signed-in
 * portfolio. Server-rendered; every plan carries the honesty caveats (the
 * catalog is unverified and award availability is not checked).
 */
export function BestRedemptionsSection({
  result,
}: {
  result: PlanRedemptionResultDto;
}) {
  const plans = result.plans;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Best ways to use your points
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Ranked from your balances, active transfer bonuses
          {result.activeBonusCount === 0 ? " (none on record)" : ""} and a
          curated, unverified sweet-spot catalog. Estimates only: award
          availability is not checked, so confirm space on the provider&apos;s
          site before transferring (transfers cannot be undone).
        </p>
      </div>
      <TransferEligibilityWarnings warnings={result.eligibilityWarnings ?? []} />
      {result.expiringHoldings.length > 0 && (
        <p className="text-xs text-gold">
          Expiring soon:{" "}
          {result.expiringHoldings
            .map(
              (h) =>
                `${h.providerId} (${formatPoints(h.points)} pts, ${h.daysUntilExpiry}d)${h.usedByPlan ? "" : " - not used by any plan below"}`,
            )
            .join("; ")}
        </p>
      )}
      {plans.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-muted">
          {result.notes[0] ??
            "No matching redemption for your balances yet."}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanCard({ plan }: { plan: RedemptionPlanDto }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="break-words font-medium text-ink">
          {plan.title}
          {plan.units > 1 ? ` x${plan.units}` : ""}
        </p>
        <span className="text-xs font-semibold text-gold">
          {plan.effectiveCentsPerPoint}¢/pt
        </span>
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-muted">
        {plan.steps.map((step, index) => (
          <li key={index}>{step.text}</li>
        ))}
      </ol>
      {plan.sources.filter(source => source.eligibility?.sourceUrl).map(source => (
        <p key={source.providerId} className="mt-1 text-xs text-ink-faint">
          {source.eligibility?.cardProductId ? findCardProduct(source.eligibility.cardProductId)?.displayName : source.displayName}{" · "}
          base ratio {source.ratioFrom}:{source.ratioTo}{source.eligibility?.effectiveFrom ? ` from ${source.eligibility.effectiveFrom.slice(0, 10)}` : ""}{" · "}
          <a href={source.eligibility?.sourceUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">Issuer terms</a>
        </p>
      ))}
      <p className="mt-2 text-xs text-ink-faint">
        {plan.status === "fundable"
          ? `~${formatUsdFromCents(plan.valueCents)} value · spends ${formatPoints(plan.totalSourcePoints)} pts`
          : `Short ${formatPoints(plan.shortfall?.pointsNeeded ?? 0)} pts`}
        {" · confidence "}
        {plan.confidence}
        {plan.expiryUrgency !== "none" ? ` · uses expiring points (${plan.expiryUrgency})` : ""}
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        {plan.caveats.join(" ")}
      </p>
    </li>
  );
}
