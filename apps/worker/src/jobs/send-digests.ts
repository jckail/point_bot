import type { Mailer, UserDirectory } from "@pointup/core";

import type { WorkerContainer } from "../container";
import { renderDigestEmail } from "../digest-email";

/**
 * Scheduled job: email each user a summary of their portfolio. Users without
 * a resolvable email or without linked accounts are skipped.
 */
export async function sendDigests(
  container: WorkerContainer,
  directory: UserDirectory,
  mailer: Mailer,
): Promise<void> {
  const userIds = await container.accounts.listUserIds();
  console.info(`[digest] starting for ${userIds.length} user(s)`);

  let sent = 0;
  let skipped = 0;
  for (const userId of userIds) {
    const email = await directory.getEmail(userId).catch((error: unknown) => {
      console.warn(`[digest] user=${userId} directory lookup failed`, error);
      return null;
    });
    if (!email) {
      skipped += 1;
      continue;
    }

    const digest =
      await container.useCases.buildPortfolioDigest.execute(userId);
    if (digest.accounts.length === 0) {
      skipped += 1;
      continue;
    }

    await mailer.send(renderDigestEmail(digest, email));
    sent += 1;
  }

  console.info(`[digest] done: ${sent} sent, ${skipped} skipped`);
}
