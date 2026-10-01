import { afterAll, describe, expect, it } from "vitest";
import type { ProviderId } from "../src/domain/loyalty/provider";
import { sql } from "drizzle-orm";

import { createDb } from "../src/infrastructure/db/client";
import {
  DrizzleActivityEventRepository,
  DrizzleLoyaltyAccountRepository,
  DrizzleTripGoalRepository,
} from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import type { LoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import type { TripGoal } from "../src/domain/loyalty/trip-goal";

/** Join tables + FKs on a real Postgres (opt in with TEST_DATABASE_URL). */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("tags and goal accounts as join tables", () => {
  const db = createDb(url ?? "postgresql://unused");
  const userId = `jt-${crypto.randomUUID()}`;
  const now = new Date();
  const accounts = new DrizzleLoyaltyAccountRepository(db);
  const goals = new DrizzleTripGoalRepository(db);

  const account = (
    id: string,
    providerId: ProviderId,
    tags: string[],
  ): LoyaltyAccount => ({
    id: `${userId}-${id}`,
    userId,
    providerId,
    membershipNumber: "1",
    credentialRef: null,
    expiresAt: null,
    notes: null,
    tags,
    pinnedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const goal = (accountIds: string[]): TripGoal => ({
    id: `${userId}-g`,
    userId,
    title: "Trip",
    targetPoints: 1000,
    targetDate: null,
    accountIds,
    status: "active",
    notes: null,
    createdAt: now,
    updatedAt: now,
  });

  afterAll(async () => {
    await db.execute(sql`delete from activity_event where user_id = ${userId}`);
    await db.execute(sql`delete from trip_goal where user_id = ${userId}`);
    await db.execute(
      sql`delete from loyalty_account where user_id = ${userId}`,
    );
  });

  it("round-trips tags in order, replaces them on update, and dedupes", async () => {
    const a = account("a", "united", ["work", "travel", "work"]);
    await accounts.insert(a);
    expect((await accounts.findById(a.id))?.tags).toEqual(["work", "travel"]);

    await accounts.update({ ...a, tags: ["zeta", "alpha"] });
    expect((await accounts.findById(a.id))?.tags).toEqual(["zeta", "alpha"]);
    expect((await accounts.findByUserId(userId))[0]?.tags).toEqual([
      "zeta",
      "alpha",
    ]);

    await accounts.update({ ...a, tags: [] });
    expect((await accounts.findById(a.id))?.tags).toEqual([]);
  });

  it("round-trips goal account ids in order and cascades on account delete", async () => {
    const a = account("a", "united", []);
    const b = account("b", "delta", []);
    await accounts.insert(b);
    const g = goal([b.id, a.id]);
    await goals.insert(g);
    expect((await goals.findById(g.id))?.accountIds).toEqual([b.id, a.id]);

    await goals.update({ ...g, accountIds: [a.id] });
    expect((await goals.findByUserId(userId))[0]?.accountIds).toEqual([a.id]);

    await goals.update({ ...g, accountIds: [a.id, b.id] });
    await accounts.delete(b.id);
    expect((await goals.findById(g.id))?.accountIds).toEqual([a.id]);

    await goals.delete(g.id);
    const left = await db.execute(
      sql`select 1 from trip_goal_account where goal_id = ${g.id}`,
    );
    expect(left.length).toBe(0);
  });

  it("rejects goal links to unknown accounts and nulls activity account refs", async () => {
    await expect(goals.insert(goal(["nope"]))).rejects.toThrow();

    const a = account("c", "hyatt", []);
    await accounts.insert(a);
    await new DrizzleActivityEventRepository(db).insert({
      id: `${userId}-e`,
      userId,
      type: "balance_manual",
      accountId: a.id,
      providerId: "hyatt",
      summary: "x",
      occurredAt: now,
    });
    await accounts.delete(a.id);
    const events = await new DrizzleActivityEventRepository(db).findByUserId(
      userId,
      10,
    );
    expect(events[0]?.accountId).toBeNull();
  });
});
