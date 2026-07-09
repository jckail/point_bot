import type { Mailer, Notifier, UserDirectory } from "@pointup/core";

import type { WorkerContainer } from "../container";
import { renderDigestChat } from "../digest-chat";
import { renderDigestEmail } from "../digest-email";

/**
 * Scheduled job: email each user a summary of their portfolio, and optionally
 * post it to configured chat channels (Slack/Discord). Users without a
 * resolvable email or without linked accounts are skipped for email; chat
 * delivery still fires for any user with accounts.
 */
export async function sendDigests(
  container: WorkerContainer,
  directory: UserDirectory,
  mailer: Mailer,
  notifier: Notifier | null = null,
): Promise<void> {
  const userIds = await container.accounts.listUserIds();
  console.info(`[digest] starting for ${userIds.length} user(s)`);

  let sent = 0;
  let skipped = 0;
  let notified = 0;
  for (const userId of userIds) {
    const digest =
      await container.useCases.buildPortfolioDigest.execute(userId);
    if (digest.accounts.length === 0) {
      skipped += 1;
      continue;
    }

    // Chat delivery (Slack/Discord) does not depend on an email address.
    if (notifier) {
      await notifier
        .notify(renderDigestChat(digest))
        .then(() => {
          notified += 1;
        })
        .catch((error: unknown) => {
          console.warn(`[digest] user=${userId} chat notify failed`, error);
        });
    }

    const email = await directory.getEmail(userId).catch((error: unknown) => {
      console.warn(`[digest] user=${userId} directory lookup failed`, error);
      return null;
    });
    if (!email) {
      skipped += 1;
      continue;
    }

    await mailer.send(renderDigestEmail(digest, email));
    sent += 1;
  }

  console.info(
    `[digest] done: ${sent} emailed, ${notified} chat-notified, ${skipped} skipped`,
  );
}
