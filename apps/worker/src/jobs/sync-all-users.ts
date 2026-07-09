import type { WorkerContainer } from "../container";

/**
 * Scheduled job: refresh balances for every user with linked accounts.
 * Failures are per-account outcomes, never batch aborts.
 */
export async function syncAllUsers(container: WorkerContainer): Promise<void> {
  const userIds = await container.accounts.listUserIds();
  console.info(`[sync] starting for ${userIds.length} user(s)`);

  let synced = 0;
  let failed = 0;
  for (const userId of userIds) {
    const outcomes =
      await container.useCases.syncAllLoyaltyAccounts.execute(userId);
    for (const outcome of outcomes) {
      if (outcome.ok) {
        synced += 1;
      } else {
        failed += 1;
        console.warn(
          `[sync] user=${userId} account=${outcome.accountId} error=${outcome.errorCode}`,
        );
      }
    }
  }

  console.info(`[sync] done: ${synced} synced, ${failed} skipped/failed`);
}
