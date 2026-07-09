import type {
  LoyaltyAccountReadModel,
  PortfolioSummaryReadModel,
  ValueAdviceReadModel,
} from "@pointup/core";

const num = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** `~$1,234` style short value. */
function value(cents: number): string {
  return `~${usd.format(cents / 100)}`;
}

/** Portfolio snapshot: totals plus the most valuable programs. */
export function formatPortfolio(
  summary: PortfolioSummaryReadModel,
  accounts: readonly LoyaltyAccountReadModel[],
): string {
  if (summary.accountCount === 0) {
    return "You have no linked programs yet. Link one on the dashboard, or try the demo portfolio.";
  }
  const top = [...accounts]
    .sort((a, b) => b.estimatedValueCents - a.estimatedValueCents)
    .slice(0, 8)
    .map((a) => {
      const pts = a.latestBalance ? num.format(a.latestBalance.points) : "—";
      return `• ${a.provider.displayName}: ${pts} ${a.provider.pointsCurrency} (${value(a.estimatedValueCents)})`;
    });
  const header = `You're tracking ${summary.accountCount} program${summary.accountCount === 1 ? "" : "s"}: ${num.format(summary.totalPoints)} points, worth about ${usd.format(summary.totalValueCents / 100)}.`;
  return [header, ...top].join("\n");
}

/** Accounts expiring within the warning window, soonest first. */
export function formatExpiring(
  accounts: readonly LoyaltyAccountReadModel[],
): string {
  const expiring = accounts
    .filter((a) => a.daysUntilExpiry !== null)
    .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0));
  if (expiring.length === 0) {
    return "Nothing expiring soon. 🎉";
  }
  const lines = expiring.slice(0, 10).map((a) => {
    const days = a.daysUntilExpiry ?? 0;
    const when =
      days < 0 ? "may have expired" : `in ${days} day${days === 1 ? "" : "s"}`;
    return `• ${a.provider.displayName}: ${when}`;
  });
  return [`${expiring.length} program(s) at risk:`, ...lines].join("\n");
}

/** Best transfer moves and affordable deals for the user's balances. */
export function formatValueAdvice(advice: ValueAdviceReadModel): string {
  const parts: string[] = [];

  if (advice.transfers.length > 0) {
    parts.push("Best transfers right now:");
    for (const t of advice.transfers.slice(0, 5)) {
      const bonus = t.bonusLabel ? ` — ${t.bonusLabel}` : "";
      parts.push(
        `• ${t.from.displayName} ${num.format(t.sourcePoints)} → ${num.format(t.destinationPoints)} ${t.to.displayName} (~${t.effectiveCentsPerPoint}¢/pt${bonus})`,
      );
    }
  }

  const affordable = advice.deals.filter((d) => d.affordable).slice(0, 5);
  if (affordable.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("Deals you can afford:");
    for (const d of affordable) {
      const cpp =
        d.realizedCentsPerPoint !== null
          ? ` (~${d.realizedCentsPerPoint}¢/pt)`
          : "";
      parts.push(`• ${d.deal.title}${cpp} — ${d.affordabilityNote}`);
    }
  }

  if (parts.length === 0) {
    return "No transfer or deal advice yet — link a transferable currency (Chase UR, Amex MR, Bilt) and record a balance.";
  }
  return parts.join("\n");
}

/** Confirm live transfer ratios before moving points — they're irreversible. */
export const TRANSFER_DISCLAIMER =
  "Confirm live transfer ratios and bonus windows before moving points — transfers are usually irreversible.";
