import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  ListActiveTransferBonuses,
  RecordTransferBonus,
} from "../src/application/loyalty/transfer-bonuses";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { createDb } from "../src/infrastructure/db/client";
import { domainEventOutbox } from "../src/infrastructure/db/schema";

/** Opt in with TEST_DATABASE_URL against a migrated Postgres (0014+). */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("transfer bonuses on Postgres (Drizzle)", () => {
  const db = createDb(url ?? "postgresql://unused");
  const userId = `tb-${crypto.randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await db.execute(sql`delete from transfer_bonus where created_by = ${userId}`);
    await db.execute(sql`delete from domain_event_outbox where user_id = ${userId}`);
  });

  it("round-trips a bonus, lists only active windows and writes the event atomically", async () => {
    const repos = buildDrizzleRepositories(db);
    const now = new Date();
    const record = new RecordTransferBonus(repos.transferBonuses, { now: () => now }, repos.eventing);
    const day = 86_400_000;
    const active = await record.execute({
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "hyatt",
      multiplierPermille: 1300,
      startsAt: new Date(now.getTime() - day),
      endsAt: new Date(now.getTime() + day),
      source: "user",
      sourceUrl: "https://example.com/promo",
      createdBy: userId,
    });
    await record.execute({
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "united",
      multiplierPermille: 1200,
      startsAt: new Date(now.getTime() - 5 * day),
      endsAt: new Date(now.getTime() - 3 * day),
      source: "user",
      createdBy: userId,
    });

    const listed = await new ListActiveTransferBonuses(repos.transferBonuses, {
      now: () => now,
    }).execute(userId);
    const mine = listed.filter((b) => b.createdBy === userId);
    expect(mine.map((b) => b.id)).toEqual([active.id]);
    expect(mine[0]).toMatchObject({
      multiplierPermille: 1300,
      source: "user",
      sourceUrl: "https://example.com/promo",
      verifiedAt: null,
    });
    expect((await repos.transferBonuses.findById(active.id))!.endsAt.getTime()).toBe(
      active.endsAt.getTime(),
    );

    const events = await db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.userId, userId));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === "transfer_bonus.recorded")).toBe(true);
  });

  it("the database itself rejects out-of-range multipliers and inverted windows", async () => {
    const repos = buildDrizzleRepositories(db);
    const base = {
      id: crypto.randomUUID(),
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "hyatt",
      multiplierPermille: 1300,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 1000),
      source: "user" as const,
      sourceUrl: null,
      verifiedAt: null,
      createdBy: userId,
      createdAt: new Date(),
    };
    await expect(
      repos.transferBonuses.insert({ ...base, multiplierPermille: 1000 }),
    ).rejects.toThrow();
    await expect(
      repos.transferBonuses.insert({ ...base, id: crypto.randomUUID(), endsAt: base.startsAt }),
    ).rejects.toThrow();
  });
});
