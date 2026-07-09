import { buildExpirationCalendar } from "@pointup/core";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/**
 * iCalendar feed of account expiration dates. Subscribe from Apple Calendar,
 * Google Calendar, or Outlook via the authenticated URL.
 */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    // Wide window so the feed includes anything still on the books.
    const expiring =
      await getContainer().useCases.listExpiringAccounts.execute(userId, 3650);
    const ics = buildExpirationCalendar(expiring);

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="pointup-expirations.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
