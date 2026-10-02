import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ManageAssistantActions } from "../src/application/assistant/manage-actions";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { GetLoyaltyAccount } from "../src/application/loyalty/get-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { UpdateLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("private proposal identity evidence on dedicated PostgreSQL", () => {
  const prefix = `proposal-membership-${randomUUID()}`;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") throw new Error("Requires the dedicated loopback postgres/app fixture.");
    db = createDb(url!, { max: 2 });
    expect((await db.$client`SELECT to_regclass('public.assistant_action') AS actions`)[0]?.actions).not.toBeNull();
  });
  afterAll(async () => {
    if (!db) return;
    try {
      const pattern = `${prefix}%`;
      await db.$client`DELETE FROM assistant_action WHERE user_id LIKE ${pattern}`;
      await db.$client`DELETE FROM domain_event_outbox WHERE user_id LIKE ${pattern}`;
      await db.$client`DELETE FROM activity_event WHERE user_id LIKE ${pattern}`;
      await db.$client`DELETE FROM loyalty_account WHERE user_id LIKE ${pattern}`;
    } finally { await db.$client.end({ timeout: 5 }); }
  });
  async function fixture() {
    const owner = UserId.parse(`${prefix}-${randomUUID()}`), now = new Date(), clock = { now: () => now };
    const repos = buildDrizzleRepositories(db), eventing = repos.eventing, repository = repos.assistantActions;
    if (!eventing || !repository) throw new Error("Requires production action repository and atomic eventing.");
    const account = createLoyaltyAccount({ userId: owner, providerId: "hyatt", membershipNumber: "PRIVATE_PG_ORIGINAL_MEMBER", now });
    await repos.loyaltyAccounts.insert(account);
    const useCases = {
      getLoyaltyAccount: new GetLoyaltyAccount(repos.loyaltyAccounts, repos.balanceSnapshots, clock),
      recordManualBalance: new RecordManualBalance(repos.loyaltyAccounts, repos.balanceSnapshots, repos.activity, clock, eventing),
      createTripGoal: new CreateTripGoal(repos.tripGoals, repos.loyaltyAccounts, repos.balanceSnapshots, clock, eventing),
    };
    const service = new ManageAssistantActions(repository, useCases, clock, undefined, eventing.unitOfWork);
    const update = new UpdateLoyaltyAccount(repos.loyaltyAccounts, repos.activity, clock, eventing);
    const propose = () => service.proposeManualBalance({ userId: owner, requestId: "pg-identity", accountId: account.id, points: 100, capturedAt: now.toISOString() });
    return { owner, account, repos, repository, useCases, service, update, propose };
  }
  async function expectNoBalanceEffects(f: Awaited<ReturnType<typeof fixture>>) {
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(0);
    expect((await db.$client`SELECT count(*)::int AS count FROM activity_event WHERE user_id = ${f.owner} AND type = 'balance_manual'`)[0]?.count).toBe(0);
    expect((await db.$client`SELECT count(*)::int AS count FROM domain_event_outbox WHERE user_id = ${f.owner} AND type = 'balance.recorded'`)[0]?.count).toBe(0);
  }

  it("round-trips private JSONB evidence while unchanged membership executes once", async () => {
    const f = await fixture(), dto = await f.propose();
    const stored = await f.repository.findOwned(dto.id, f.owner), witness = stored?.executionWitness;
    if (!witness) throw new Error("Missing persisted identity witness");
    const [row] = await db.$client`SELECT payload FROM assistant_action WHERE id = ${dto.id} AND user_id = ${f.owner}`;
    expect(row?.payload.__pointupExecutionWitness).toEqual(witness);
    expect(JSON.stringify(row?.payload)).not.toContain("PRIVATE_PG_ORIGINAL_MEMBER");
    expect(JSON.stringify([dto, await f.service.list(f.owner)])).not.toContain(witness.digest);
    expect(JSON.stringify(dto)).not.toContain(witness.nonce);
    expect((await f.propose()).id).toBe(dto.id);
    expect((await f.repository.findOwned(dto.id, f.owner))?.executionWitness).toEqual(witness);
    expect(await f.service.approve(dto.id, f.owner)).toMatchObject({ status: "succeeded", result: { points: 100 } });
    expect(await f.service.approve(dto.id, f.owner)).toMatchObject({ status: "succeeded" });
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(1);
    expect((await db.$client`SELECT count(*)::int AS count FROM domain_event_outbox WHERE user_id = ${f.owner} AND type = 'balance.recorded'`)[0]?.count).toBe(1);
  });

  it("rejects replacement membership committed after the service precheck at the actual mutation lock", async () => {
    const f = await fixture(), dto = await f.propose(), read = f.useCases.getLoyaltyAccount.execute.bind(f.useCases.getLoyaltyAccount);
    vi.spyOn(f.useCases.getLoyaltyAccount, "execute").mockImplementation(async (...args) => {
      const stale = await read(...args);
      await f.update.execute({ userId: f.owner, accountId: f.account.id, membershipNumber: "PRIVATE_PG_REPLACEMENT_MEMBER" });
      return stale;
    });
    const result = await f.service.approve(dto.id, f.owner);
    expect(result).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PG|digest|nonce|executionWitness/);
    expect((await f.repository.findOwned(dto.id, f.owner))?.status).toBe("failed");
    await expectNoBalanceEffects(f);
  });

  it("conditionally recovers and audits stale executions once across concurrent PostgreSQL callers", async () => {
    const f = await fixture(), foreign = await fixture(), dto = await f.propose(), foreignDto = await foreign.propose();
    const stored = await f.repository.findOwned(dto.id, f.owner);
    if (!stored) throw new Error("Missing synthetic proposal");
    const now = new Date(), cutoff = new Date(now.getTime() - 5 * 60000);
    await db.$client`UPDATE assistant_action SET status = 'executing', updated_at = ${cutoff.toISOString()}::timestamptz WHERE id IN (${dto.id}, ${foreignDto.id})`;
    await f.repository.insert({ ...stored, id: `${dto.id}-recent`, status: "executing", updatedAt: new Date(cutoff.getTime() + 1) });
    await f.repository.insert({ ...stored, id: `${dto.id}-terminal`, status: "rejected", updatedAt: cutoff });
    const audit = vi.fn(), clock = { now: () => now };
    const first = new ManageAssistantActions(f.repository, f.useCases, clock, audit);
    const second = new ManageAssistantActions(f.repository, f.useCases, clock, audit);
    await Promise.all([first.list(f.owner), second.list(f.owner)]);
    await first.list(f.owner);
    expect(audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: dto.id, kind: "manual_balance", status: "unknown" }]]);
    expect((await f.repository.findOwned(dto.id, f.owner))?.status).toBe("unknown");
    expect((await f.repository.findOwned(`${dto.id}-recent`, f.owner))?.status).toBe("executing");
    expect((await f.repository.findOwned(`${dto.id}-terminal`, f.owner))?.status).toBe("rejected");
    expect((await foreign.repository.findOwned(foreignDto.id, foreign.owner))?.status).toBe("executing");
    expect(await f.repository.expireExecuting(f.owner, cutoff, now)).toEqual([]);
    const transitions = await foreign.repository.expireExecuting(foreign.owner, cutoff, now);
    expect(transitions).toEqual([{ id: foreignDto.id, kind: "manual_balance", status: "unknown" }]);
    expect(JSON.stringify([audit.mock.calls, transitions])).not.toMatch(/PRIVATE_PG|digest|nonce|executionWitness|payload|userId/);
    await first.approve(dto.id, f.owner);
    await expectNoBalanceEffects(f);
  });

  it("keeps legacy witnessless pending rows readable but refuses execution", async () => {
    const f = await fixture(), dto = await f.propose();
    await db.$client`UPDATE assistant_action SET payload = payload - '__pointupExecutionWitness' WHERE id = ${dto.id} AND user_id = ${f.owner}`;
    expect((await f.service.list(f.owner))[0]).toMatchObject({ id: dto.id, status: "pending" });
    expect(await f.service.approve(dto.id, f.owner)).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    await expectNoBalanceEffects(f);
  });
});
