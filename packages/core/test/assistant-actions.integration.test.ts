import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ManageAssistantActions } from "../src/application/assistant/manage-actions";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { GetLoyaltyAccount } from "../src/application/loyalty/get-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { AssistantActionNotFoundError } from "../src/domain/assistant/actions";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";

// CI applies the managed migrations first. Never opt in via application env.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("reviewed proposals and outbox on dedicated PostgreSQL", () => {
  const prefix = `proposal-fixture-${randomUUID()}`;
  const browserRole = `proposal_browser_${randomUUID().replaceAll("-", "")}`;
  let db: ReturnType<typeof createDb>;
  let roleCreated = false;

  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Proposal integration tests require the dedicated loopback postgres/app fixture.");
    }
    db = createDb(url!, { max: 6 });
    expect((await db.$client`SELECT to_regclass('public.assistant_action') AS actions`)[0]?.actions).not.toBeNull();
    await db.$client.unsafe(`CREATE ROLE ${browserRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    roleCreated = true;
    await db.$client.unsafe(`GRANT USAGE ON SCHEMA public TO ${browserRole}`);
    await db.$client.unsafe(`GRANT SELECT ON assistant_action TO ${browserRole}`);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      const ownerPattern = prefix + "%";
      await db.$client`DELETE FROM assistant_action WHERE user_id LIKE ${ownerPattern}`;
      await db.$client`DELETE FROM domain_event_outbox WHERE user_id LIKE ${ownerPattern}`;
      await db.$client`DELETE FROM activity_event WHERE user_id LIKE ${ownerPattern}`;
      await db.$client`DELETE FROM trip_goal WHERE user_id LIKE ${ownerPattern}`;
      await db.$client`DELETE FROM loyalty_account WHERE user_id LIKE ${ownerPattern}`;
      if (roleCreated) {
        if (!/^proposal_browser_[a-f0-9]{32}$/.test(browserRole)) throw new Error("Refusing to remove an unowned fixture role.");
        await db.$client.unsafe(`DROP OWNED BY ${browserRole}`);
        await db.$client.unsafe(`DROP ROLE ${browserRole}`);
      }
    } finally { await db.$client.end({ timeout: 5 }); }
  });

  async function fixture() {
    const owner = UserId.parse(`${prefix}-${randomUUID()}`);
    let now = new Date();
    const clock = { now: () => new Date(now) };
    const repos = buildDrizzleRepositories(db);
    const repository = repos.assistantActions;
    const eventing = repos.eventing;
    if (!repository || !eventing) throw new Error("Fixture requires composed proposal storage and transactional events.");
    const account = createLoyaltyAccount({ userId: owner, providerId: "hyatt", membershipNumber: "synthetic-fixture", now });
    await repos.loyaltyAccounts.insert(account);
    const useCases = {
      getLoyaltyAccount: new GetLoyaltyAccount(repos.loyaltyAccounts, repos.balanceSnapshots, clock),
      recordManualBalance: new RecordManualBalance(repos.loyaltyAccounts, repos.balanceSnapshots, repos.activity, clock, eventing),
      createTripGoal: new CreateTripGoal(repos.tripGoals, repos.loyaltyAccounts, repos.balanceSnapshots, clock, eventing),
    };
    const service = new ManageAssistantActions(repository, useCases, clock, undefined, eventing.unitOfWork);
    const propose = () => service.proposeManualBalance({ userId: owner, requestId: "fixture-request", accountId: account.id, points: 100 });
    return { owner, account, repos, repository, useCases, eventing, service, propose,
      advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
  }

  it("persists immutable owner-bound proposals without writing a balance", async () => {
    const f = await fixture();
    const action = await f.propose();
    expect((await f.propose()).id).toBe(action.id);
    if (action.kind !== "manual_balance") throw new Error("Unexpected proposal kind.");
    action.payload.points = 900;
    expect((await f.repository.findOwned(action.id, f.owner))?.payload).toMatchObject({ points: 100 });
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(0);
    await expect(f.service.approve(action.id, UserId.parse(`${prefix}-foreign`))).rejects.toBeInstanceOf(AssistantActionNotFoundError);
  });

  it("expires and rejects single-use proposals without mutation", async () => {
    const f = await fixture();
    const action = await f.propose();
    f.advance(16 * 60_000);
    expect(await f.service.approve(action.id, f.owner)).toMatchObject({ status: "expired" });
    const rejected = await f.service.proposeTripGoal({ userId: f.owner, requestId: "goal", title: "Fixture trip", targetPoints: 1000, accountIds: [f.account.id] });
    expect(await f.service.reject(rejected.id, f.owner)).toMatchObject({ status: "rejected" });
    expect(await f.service.approve(rejected.id, f.owner)).toMatchObject({ status: "rejected" });
    expect(await f.repos.tripGoals.findByUserId(f.owner)).toHaveLength(0);
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(0);
  });

  it("concurrent approvals commit one snapshot, succeeded journal and outbox event", async () => {
    const f = await fixture();
    const action = await f.propose();
    await Promise.all([f.service.approve(action.id, f.owner), f.service.approve(action.id, f.owner)]);
    expect(await f.service.approve(action.id, f.owner)).toMatchObject({ status: "succeeded", result: { points: 100 } });
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(1);
    expect(await db.$client`SELECT id FROM domain_event_outbox WHERE user_id = ${f.owner} AND type = 'balance.recorded'`).toHaveLength(1);
    expect(await db.$client`SELECT id FROM activity_event WHERE user_id = ${f.owner}`).toHaveLength(1);
  });

  it("hides proposal payloads from a nonprivileged browser role even with SELECT granted", async () => {
    const f = await fixture();
    await f.propose();
    const visible = await db.$client.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${browserRole}`);
      return tx`SELECT id FROM assistant_action`;
    });
    expect(visible).toHaveLength(0);
    expect(await f.repository.listOwned(f.owner, 10)).toHaveLength(1);
  });

  it("rolls back snapshot, activity and outbox when succeeded journaling fails", async () => {
    const f = await fixture();
    const action = await f.propose();
    const finish = f.repository.finish.bind(f.repository);
    const spy = vi.spyOn(f.repository, "finish").mockImplementation(async (id, userId, status, now, result, code) => {
      if (status === "succeeded") throw new Error("synthetic journal failure");
      await finish(id, userId, status, now, result, code);
    });
    try {
      expect(await f.service.approve(action.id, f.owner)).toMatchObject({ status: "unknown" });
      await f.service.approve(action.id, f.owner);
      expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(0);
      expect(await db.$client`SELECT id FROM activity_event WHERE user_id = ${f.owner}`).toHaveLength(0);
      expect(await db.$client`SELECT id FROM domain_event_outbox WHERE user_id = ${f.owner}`).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });

  it("rolls back the mutation and journal when publishing its outbox event fails", async () => {
    const f = await fixture();
    const action = await f.propose();
    const spy = vi.spyOn(f.eventing.publisher, "publish").mockRejectedValueOnce(new Error("synthetic outbox failure"));
    try {
      expect(await f.service.approve(action.id, f.owner)).toMatchObject({ status: "unknown" });
      expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(0);
      expect(await db.$client`SELECT id FROM activity_event WHERE user_id = ${f.owner}`).toHaveLength(0);
      expect(await db.$client`SELECT id FROM domain_event_outbox WHERE user_id = ${f.owner}`).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
});
