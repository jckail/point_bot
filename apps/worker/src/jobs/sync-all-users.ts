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
  // Users are independent and provider fetches are network-bound, so a few in
  // flight at once multiplies throughput (SYNC_USER_CONCURRENCY, default 1 =
  // the original sequential behaviour; keep users x per-user fan-out within
  // the DB pool size, see docs/performance.md).
  const width = Math.max(
    1,
    Math.min(Number(process.env.SYNC_USER_CONCURRENCY) || 1, userIds.length),
  );
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < userIds.length; i = next++) {
      const userId = userIds[i]!;
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
  };
  await Promise.all(Array.from({ length: width }, lane));

  console.info(`[sync] done: ${synced} synced, ${failed} skipped/failed`);
}
