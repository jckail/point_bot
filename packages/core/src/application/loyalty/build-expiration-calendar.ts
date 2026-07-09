import type { LoyaltyAccountReadModel } from "./read-models";

/**
 * Builds an iCalendar (RFC 5545) document from accounts that have an
 * expiry date. Calendar apps can subscribe to `GET /api/v1/calendar.ics`.
 */
export function buildExpirationCalendar(
  accounts: readonly LoyaltyAccountReadModel[],
  options: {
    readonly calendarName?: string;
    readonly productId?: string;
  } = {},
): string {
  const calendarName = options.calendarName ?? "PointUp expirations";
  const productId = options.productId ?? "-//PointUp//Expirations//EN";
  const stamp = formatIcalUtc(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${productId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
  ];

  for (const account of accounts) {
    if (!account.expiresAt) continue;

    const day = account.expiresAt.toISOString().slice(0, 10).replaceAll("-", "");
    const uid = `expiry-${account.id}@pointup`;
    const summary = `${account.provider.displayName} points expire`;
    const description = [
      `${account.provider.displayName} (${account.membershipNumber})`,
      account.latestBalance
        ? `Balance: ${account.latestBalance.points.toLocaleString("en-US")} ${account.provider.pointsCurrency}`
        : null,
      "Open PointUp to sync or redeem before this date.",
    ]
      .filter(Boolean)
      .join("\\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${escapeIcalText(summary)}`,
      `DESCRIPTION:${escapeIcalText(description)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function formatIcalUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeIcalText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}
