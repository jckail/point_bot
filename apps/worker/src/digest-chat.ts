import type { OutboundNotification, PortfolioDigestReadModel } from "@pointup/core";

const num = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Renders the periodic portfolio digest as a compact chat notification
 * (Slack/Discord). Kept parallel to `renderDigestEmail` — same data, a shorter
 * shape suited to a chat message.
 */
export function renderDigestChat(
  digest: PortfolioDigestReadModel,
): OutboundNotification {
  const { summary, accounts, expiring } = digest;
  const total = usd.format(summary.totalValueCents / 100);

  const lines = [
    `*PointBot weekly digest* — ${num.format(summary.totalPoints)} points across ${summary.accountCount} program${summary.accountCount === 1 ? "" : "s"}, ~${total}.`,
  ];

  for (const account of accounts.slice(0, 6)) {
    const points = account.latestBalance
      ? num.format(account.latestBalance.points)
      : "—";
    lines.push(
      `• ${account.provider.displayName}: ${points} ${account.provider.pointsCurrency} (~${usd.format(account.estimatedValueCents / 100)})`,
    );
  }

  if (expiring.length > 0) {
    const soonest = expiring
      .map((a) => a.provider.displayName)
      .slice(0, 3)
      .join(", ");
    lines.push(
      `⚠️ ${expiring.length} program${expiring.length === 1 ? "" : "s"} expiring soon: ${soonest}.`,
    );
  }

  const markdown = lines.join("\n");
  // Plain-text fallback strips Slack emphasis markers.
  const text = markdown.replace(/\*/g, "");
  return { text, markdown };
}
