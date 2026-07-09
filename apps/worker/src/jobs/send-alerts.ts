import {
  deriveAlerts,
  type DeriveAlertsOptions,
  type Mailer,
  type Notifier,
  type UserDirectory,
} from "@pointup/core";

import type { WorkerContainer } from "../container";
import { renderAlertsChat, renderAlertsEmail } from "../alerts-render";

/**
 * Scheduled job: derive urgent, actionable alerts per user (expiring points,
 * reached goals, large balance moves) and push them via chat (Notifier) and,
 * when an email is resolvable, email. Users with no alerts are skipped — the
 * point of alerts is that they only fire when something needs attention.
 */
export async function sendAlerts(
  container: WorkerContainer,
  directory: UserDirectory,
  mailer: Mailer,
  notifier: Notifier | null,
  options: DeriveAlertsOptions = {},
): Promise<void> {
  const userIds = await container.accounts.listUserIds();
  console.info(`[alerts] scanning ${userIds.length} user(s)`);

  let alertedUsers = 0;
  let totalAlerts = 0;
  for (const userId of userIds) {
    const digest =
      await container.useCases.buildPortfolioDigest.execute(userId);
    if (digest.accounts.length === 0) continue;

    const alerts = deriveAlerts(digest, options);
    if (alerts.length === 0) continue;

    alertedUsers += 1;
    totalAlerts += alerts.length;

    if (notifier) {
      await notifier
        .notify(renderAlertsChat(alerts))
        .catch((error: unknown) =>
          console.warn(`[alerts] user=${userId} chat notify failed`, error),
        );
    }

    const email = await directory.getEmail(userId).catch(() => null);
    if (email) {
      await mailer
        .send(renderAlertsEmail(alerts, email))
        .catch((error: unknown) =>
          console.warn(`[alerts] user=${userId} email failed`, error),
        );
    }
  }

  console.info(
    `[alerts] done: ${totalAlerts} alert(s) across ${alertedUsers} user(s)`,
  );
}
