import type { OutboundEmail, PortfolioDigestReadModel } from "@pointup/core";

const numberFormat = new Intl.NumberFormat("en-US");
const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Renders the periodic portfolio digest as a brand-lite email. */
export function renderDigestEmail(
  digest: PortfolioDigestReadModel,
  to: string,
): OutboundEmail {
  const { summary, accounts, goals, expiring } = digest;
  const totalValue = usdFormat.format(summary.totalValueCents / 100);
  const subject = `Your points this week: ${numberFormat.format(summary.totalPoints)} points (~${totalValue})`;

  const lines = accounts.map((account) => {
    const points = account.latestBalance
      ? numberFormat.format(account.latestBalance.points)
      : "no balance yet";
    const value = usdFormat.format(account.estimatedValueCents / 100);
    const pin = account.pinnedAt ? " ★" : "";
    return `- ${account.provider.displayName}${pin}: ${points} ${account.provider.pointsCurrency} (~${value})`;
  });

  const goalLines =
    goals.length === 0
      ? []
      : [
          "",
          "Trip goals:",
          ...goals.map((goal) => {
            const status = goal.achieved
              ? "reached!"
              : `${goal.percentComplete}% · ${numberFormat.format(goal.remainingPoints)} to go`;
            return `- ${goal.title}: ${numberFormat.format(goal.currentPoints)} / ${numberFormat.format(goal.targetPoints)} (${status})`;
          }),
        ];

  const expiryLines =
    expiring.length === 0
      ? []
      : [
          "",
          "Expiring soon:",
          ...expiring.map((account) => {
            const days = account.daysUntilExpiry ?? 0;
            const label =
              days < 0
                ? "may have expired"
                : `in ${days} day${days === 1 ? "" : "s"}`;
            return `- ${account.provider.displayName}: ${label}`;
          }),
        ];

  const text = [
    `You're tracking ${summary.accountCount} program${summary.accountCount === 1 ? "" : "s"} worth about ${totalValue}.`,
    "",
    ...lines,
    ...goalLines,
    ...expiryLines,
    "",
    summary.lastSyncedAt
      ? `Last synced ${summary.lastSyncedAt.toISOString()}`
      : "No syncs recorded yet - open the dashboard to run one.",
  ].join("\n");

  const rows = accounts
    .map(
      (account) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #232c4e;color:#f4f6ff;">${account.provider.displayName}${account.pinnedAt ? " ★" : ""}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #232c4e;color:#9aa5cb;text-align:right;">${
            account.latestBalance
              ? numberFormat.format(account.latestBalance.points)
              : "-"
          }</td>
          <td style="padding:8px 12px;border-bottom:1px solid #232c4e;color:#ffb547;text-align:right;">~${usdFormat.format(account.estimatedValueCents / 100)}</td>
        </tr>`,
    )
    .join("");

  const goalRows =
    goals.length === 0
      ? ""
      : `
    <h2 style="color:#f4f6ff;font-size:14px;margin:24px 0 8px;">Trip goals</h2>
    <table style="border-collapse:collapse;width:100%;background:#121a30;border-radius:12px;overflow:hidden;">
      <tbody>
        ${goals
          .map(
            (goal) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #232c4e;color:#f4f6ff;">${goal.title}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #232c4e;color:#9aa5cb;text-align:right;">${goal.percentComplete}%</td>
            <td style="padding:8px 12px;border-bottom:1px solid #232c4e;color:#ffb547;text-align:right;">${numberFormat.format(goal.currentPoints)} / ${numberFormat.format(goal.targetPoints)}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;

  const expiryBlock =
    expiring.length === 0
      ? ""
      : `
    <p style="color:#ff8a7a;font-size:13px;margin:20px 0 0;">
      ${expiring.length} program${expiring.length === 1 ? "" : "s"} expiring within 90 days — open PointUp to redeem or sync.
    </p>`;

  const html = `
  <div style="background:#0b1020;padding:32px;font-family:Inter,system-ui,sans-serif;">
    <h1 style="color:#f4f6ff;font-size:20px;margin:0 0 4px;">PointUp weekly digest</h1>
    <p style="color:#9aa5cb;margin:0 0 20px;">
      ${numberFormat.format(summary.totalPoints)} points tracked, worth about
      <strong style="color:#ffb547;">${totalValue}</strong>.
    </p>
    <table style="border-collapse:collapse;width:100%;background:#121a30;border-radius:12px;overflow:hidden;">
      <thead>
        <tr>
          <th style="padding:8px 12px;text-align:left;color:#5f6a8f;font-size:12px;">Program</th>
          <th style="padding:8px 12px;text-align:right;color:#5f6a8f;font-size:12px;">Balance</th>
          <th style="padding:8px 12px;text-align:right;color:#5f6a8f;font-size:12px;">Est. value</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${goalRows}
    ${expiryBlock}
  </div>`;

  return { to, subject, text, html };
}
