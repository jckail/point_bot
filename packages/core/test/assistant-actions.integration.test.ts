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
import { DrizzleAssistantActionRepository } from "../src/infrastructure/assistant/drizzle-action-repository";
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
    return { owner, account, repos, repository, useCases, eventing, service, propose, clock,
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

  async function expectNoMutation(f: Awaited<ReturnType<typeof fixture>>) {
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(0);
    expect(await db.$client`SELECT id FROM activity_event WHERE user_id = ${f.owner}`).toHaveLength(0);
    expect(await db.$client`SELECT id FROM domain_event_outbox WHERE user_id = ${f.owner}`).toHaveLength(0);
  }

  it.each(["rejected", "expired"] as const)("returns one safe %s receipt across concurrent and repeated settlement", async status => {
    const f = await fixture(), action = await f.propose();
    if (status === "expired") f.advance(15 * 60_000);
    const receipts = await Promise.all([
      f.repository.settlePending(action.id, f.owner, status, f.clock.now()),
      f.repository.settlePending(action.id, f.owner, status, f.clock.now()),
    ]);
    expect(receipts.filter(receipt => receipt !== null)).toEqual([{ id: action.id, kind: "manual_balance", status }]);
    expect(await f.repository.settlePending(action.id, f.owner, status, f.clock.now())).toBeNull();
    expect((await f.repository.findOwned(action.id, f.owner))?.status).toBe(status);
    expect(JSON.stringify(receipts)).not.toMatch(/synthetic-fixture|payload|userId|nonce|digest|executionWitness|points/);
    await expectNoMutation(f);
  });

  it.each(["list", "reject"] as const)("audits one actual transition across concurrent %s calls", async operation => {
    const f = await fixture(), action = await f.propose(), audit = vi.fn();
    const service = new ManageAssistantActions(f.repository, f.useCases, f.clock, audit, f.eventing.unitOfWork);
    if (operation === "list") f.advance(15 * 60_000);
    const call = () => operation === "list" ? service.list(f.owner) : service.reject(action.id, f.owner);
    await Promise.all([call(), call()]);
    await call();
    expect(audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status: operation === "list" ? "expired" : "rejected" }]]);
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/synthetic-fixture|payload|userId|nonce|digest|executionWitness|points/);
    await expectNoMutation(f);
  });

  it("returns no receipt for foreign, terminal or premature-expiry rows", async () => {
    const f = await fixture(), action = await f.propose();
    expect(await f.repository.settlePending(action.id, UserId.parse(`${prefix}-foreign`), "rejected", f.clock.now())).toBeNull();
    expect(await f.repository.settlePending(action.id, f.owner, "expired", f.clock.now())).toBeNull();
    expect((await f.repository.findOwned(action.id, f.owner))?.status).toBe("pending");
    const claimed = await f.repository.claim(action.id, f.owner, f.clock.now());
    expect(claimed.outcome).toBe("claimed");
    await f.repository.finish(action.id, f.owner, "succeeded", f.clock.now(), { synthetic: true }, null);
    f.advance(16 * 60_000);
    expect(await f.repository.settlePending(action.id, f.owner, "expired", f.clock.now())).toBeNull();
    expect(await f.repository.settlePending(action.id, f.owner, "rejected", f.clock.now())).toBeNull();
    expect(await f.repository.claim(action.id, f.owner, f.clock.now())).toEqual({ outcome: "unavailable" });
    expect(await f.repository.findOwned(action.id, f.owner)).toMatchObject({ status: "succeeded", result: { synthetic: true } });
    await expectNoMutation(f);
  });

  it("lets only one concurrent claim or rejection win", async () => {
    const f = await fixture(), action = await f.propose();
    const [claim, settled] = await Promise.all([
      f.repository.claim(action.id, f.owner, f.clock.now()),
      f.repository.settlePending(action.id, f.owner, "rejected", f.clock.now()),
    ]);
    if (claim.outcome === "claimed") {
      expect(settled).toBeNull();
      expect((await f.repository.findOwned(action.id, f.owner))?.status).toBe("executing");
    } else {
      expect(claim).toEqual({ outcome: "unavailable" });
      expect(settled).toEqual({ id: action.id, kind: "manual_balance", status: "rejected" });
      expect((await f.repository.findOwned(action.id, f.owner))?.status).toBe("rejected");
    }
    await expectNoMutation(f);
  });

  it.each(["claim", "settle"] as const)("preserves the %s winner against a later competing transition", async winner => {
    const f = await fixture(), action = await f.propose();
    if (winner === "claim") {
      expect((await f.repository.claim(action.id, f.owner, f.clock.now())).outcome).toBe("claimed");
      expect(await f.repository.settlePending(action.id, f.owner, "rejected", f.clock.now())).toBeNull();
      expect((await f.repository.findOwned(action.id, f.owner))?.status).toBe("executing");
    } else {
      expect(await f.repository.settlePending(action.id, f.owner, "rejected", f.clock.now())).toEqual({ id: action.id, kind: "manual_balance", status: "rejected" });
      expect(await f.repository.claim(action.id, f.owner, f.clock.now())).toEqual({ outcome: "unavailable" });
      expect((await f.repository.findOwned(action.id, f.owner))?.status).toBe("rejected");
    }
    await expectNoMutation(f);
  });

  it("audits expiry once when concurrent approvals cross expiry during a real row-lock wait", async () => {
    const f = await fixture(), action = await f.propose(), audit = vi.fn();
    // The expiry path does not mutate balances; this clock-aware production
    // adapter deliberately uses independent transactions for its durable claims.
    const repository = new DrizzleAssistantActionRepository(db, f.clock);
    const first = new ManageAssistantActions(repository, f.useCases, f.clock, audit, f.eventing.unitOfWork);
    const second = new ManageAssistantActions(repository, f.useCases, f.clock, audit, f.eventing.unitOfWork);
    let release!: () => void, ready!: (pid: number) => void, failed!: (error: unknown) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<number>((resolve, reject) => { ready = resolve; failed = reject; });
    const blocker = db.$client.begin(async tx => {
      await tx`SELECT id FROM assistant_action WHERE id = ${action.id} FOR UPDATE`;
      const [row] = await tx`SELECT pg_backend_pid() AS pid`;
      ready(Number(row?.pid));
      await gate;
    });
    // Observe failures immediately, including assertion failures before release.
    void blocker.catch(failed);
    const pid = await locked;
    const approvals = Promise.all([first.approve(action.id, f.owner), second.approve(action.id, f.owner)]);
    void approvals.catch(() => {});
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const [row] = await db.$client`
          WITH RECURSIVE blocked AS (
            SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity
            JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS count FROM blocked`;
        if (Number(row?.count) >= 2) { waiting = true; break; }
      }
      expect(waiting, "both claims must reach the actual blocked row lock").toBe(true);
      f.advance(15 * 60_000);
    } finally { release(); await blocker; await Promise.allSettled([approvals]); }
    expect(await approvals).toMatchObject([{ status: "expired" }, { status: "expired" }]);
    await first.approve(action.id, f.owner);
    await first.list(f.owner);
    expect(audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status: "expired" }]]);
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/synthetic-fixture|payload|userId|nonce|digest|executionWitness|points/);
    await expectNoMutation(f);
  }, 10_000);

  it.each(["rejected", "expired"] as const)("keeps committed %s visible and single-use when audit throws", async status => {
    const f = await fixture(), action = await f.propose();
    const audit = vi.fn(() => { throw new Error("PRIVATE_SYNTHETIC_AUDIT_FAILURE"); });
    const service = new ManageAssistantActions(f.repository, f.useCases, f.clock, audit, f.eventing.unitOfWork);
    if (status === "expired") f.advance(15 * 60_000);
    const result = status === "expired" ? await service.approve(action.id, f.owner) : await service.reject(action.id, f.owner);
    expect(result).toMatchObject({ id: action.id, status });
    await service.reject(action.id, f.owner);
    await service.approve(action.id, f.owner);
    await service.list(f.owner);
    expect(audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status }]]);
    expect(JSON.stringify([result, audit.mock.calls])).not.toMatch(/PRIVATE_SYNTHETIC|synthetic-fixture|nonce|digest|executionWitness/);
    await expectNoMutation(f);
  });

});
