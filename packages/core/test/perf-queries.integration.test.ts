import { afterAll, describe, expect, it } from "vitest";
import type { ProviderId } from "../src/domain/loyalty/provider";
import { sql } from "drizzle-orm";

import { buildTrendContext } from "../src/application/loyalty/balance-trend";
import { createDb } from "../src/infrastructure/db/client";
import {
  DrizzleBalanceSnapshotRepository,
  DrizzleLoyaltyAccountRepository,
} from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import type { LoyaltyAccount } from "../src/domain/loyalty/loyalty-account";

/**
 * The batched trend/latest SQL (LATERAL index probes) must agree with the
 * reference reduction over full history. Opt in with TEST_DATABASE_URL.
 */
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!url)("batched snapshot reads match the full-history reduction", () => {
  const db = createDb(url ?? "postgresql://unused");
  const userId = `pq-${crypto.randomUUID()}`;
  const now = new Date("2026-06-15T12:00:00.000Z");
  const accounts = new DrizzleLoyaltyAccountRepository(db);
  const balances = new DrizzleBalanceSnapshotRepository(db);

  const account = (id: string, providerId: ProviderId): LoyaltyAccount => ({
    id: `${userId}-${id}`,
    userId,
    providerId,
    membershipNumber: "1",
    credentialRef: null,
    expiresAt: null,
    notes: null,
    tags: [],
    pinnedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const snap = (accountId: string, n: number, daysAgo: number, points: number) => ({
    id: `${accountId}-s${n}`,
    loyaltyAccountId: accountId,
    points,
    source: "sync" as const,
    capturedAt: new Date(now.getTime() - daysAgo * DAY + 123), // ms precision survives the round trip
  });

  afterAll(async () => {
    await db.execute(sql`delete from loyalty_account where user_id = ${userId}`);
  });

  it("returns the same latest/previous/30d/90d rows as buildTrendContext", async () => {
    const rich = account("rich", "united");
    const young = account("young", "delta");
    const empty = account("empty", "hyatt");
    for (const a of [rich, young, empty]) await accounts.insert(a);
    const history = [
      snap(rich.id, 0, 0, 900),
      snap(rich.id, 1, 3, 800),
      snap(rich.id, 2, 30, 700), // just inside the 30-day cutoff (not <= it)
      snap(rich.id, 3, 31, 650),
      snap(rich.id, 4, 89, 600),
      snap(rich.id, 5, 120, 500),
      snap(young.id, 0, 1, 40),
      snap(young.id, 1, 2, 30),
    ];
    for (const s of history) await balances.insert(s);

    const ids = [rich.id, young.id, empty.id];
    const batched = await balances.findTrendContextByAccountIds(ids, now);
    for (const id of ids) {
      const full = await balances.findByAccountId(id, 10_000);
      expect(batched.get(id), id).toEqual(buildTrendContext(full, now));
    }
    expect(batched.get(empty.id)).toEqual({
      latest: null,
      previous: null,
      asOf30Days: null,
      asOf90Days: null,
    });
  });

  it("findLatestByAccountIds returns the newest snapshot per account (id breaks ties)", async () => {
    const tie = account("tie", "marriott");
    await accounts.insert(tie);
    const same = new Date(now.getTime() - 5 * DAY);
    await balances.insert({ ...snap(tie.id, 1, 5, 1), capturedAt: same, id: `${tie.id}-a` });
    await balances.insert({ ...snap(tie.id, 2, 5, 2), capturedAt: same, id: `${tie.id}-b` });
    const latest = await balances.findLatestByAccountIds([tie.id, `${userId}-missing`]);
    expect(latest.size).toBe(1);
    expect(latest.get(tie.id)).toMatchObject({ id: `${tie.id}-b`, points: 2, capturedAt: same });
  });
});
