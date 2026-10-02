import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { GrantConsent, RevokeConsent } from "../src/application/agent/consents";
import {
  EventHandlerRegistry,
  OutboxProcessor,
} from "../src/application/events/outbox-processor";
import { buildAgentModule } from "../src/composition/agent-module";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { buildLoyaltyModule } from "../src/composition/loyalty-module";
import { createDomainEvent, type DomainEvent } from "../src/domain/events";
import { domainEventOutbox } from "../src/infrastructure/db/schema";
import { createDb } from "../src/infrastructure/db/client";
import { HeuristicAssistant } from "../src/infrastructure/llm/openai-compatible-assistant";
import {
  DrizzleEventPublisher,
  DrizzleOutboxStore,
  DrizzleUnitOfWork,
} from "../src/infrastructure/outbox/drizzle-outbox";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import { StubPageScraper } from "../src/infrastructure/scraper/firecrawl-page-scraper";
import { NullCredentialVault } from "../src/infrastructure/vault/null-credential-vault";
import { StaticFxRateSource } from "../src/infrastructure/fx/fx-rate-sources";

import { SlackWebhookNotifier } from "../src/infrastructure/notify/webhook-notifiers";

import { asAccountId, asUserId } from "./ids";
import type { UserId } from "../src/domain/shared/ids";
/**
 * Transactional outbox against a real, migrated Postgres. Opt in with
 * TEST_DATABASE_URL (CI provides one). Tests use unique user ids and clean up
 * their own rows; claim tests necessarily see the whole table, so run them
 * against a throwaway database.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("domain event outbox on Postgres", () => {
  const db = createDb(url ?? "postgresql://unused");
  const prefix = `ob-${crypto.randomUUID().slice(0, 8)}`;
  const user = (name: string) => asUserId(`${prefix}-${name}`);
  const store = new DrizzleOutboxStore(db);
  const publisher = new DrizzleEventPublisher(db);

  const rowsFor = (userId: string) =>
    db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.userId, userId))
      .orderBy(domainEventOutbox.occurredAt, domainEventOutbox.id);

  function ev(userId: UserId, n = 0, occurredAt = new Date(Date.now() - 60_000 + n)) {
    return createDomainEvent("account.linked", {
      userId,
      aggregateId: asAccountId(`agg-${n}`),
      occurredAt,
      payload: { providerId: "united" },
    });
  }

  afterAll(async () => {
    await db.execute(
      sql`delete from domain_event_outbox where user_id like ${`${prefix}-%`}`,
    );
    await db.execute(
      sql`delete from consent_grant where user_id like ${`${prefix}-%`}`,
    );
    await db.execute(
      sql`delete from activity_event where user_id like ${`${prefix}-%`}`,
    );
    await db.execute(
      sql`delete from loyalty_account where user_id like ${`${prefix}-%`}`,
    );
  });

  it("has RLS enabled and the partial claim index", async () => {
    const rls = await db.execute<{ relrowsecurity: boolean }>(
      sql`select relrowsecurity from pg_class where relname = 'domain_event_outbox'`,
    );
    expect(rls[0]?.relrowsecurity).toBe(true);
    const idx = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'domain_event_outbox_claim_idx'`,
    );
    expect(idx[0]?.indexdef).toMatch(/WHERE/i);
    expect(idx[0]?.indexdef).toMatch(/processed_at IS NULL/i);
    expect(idx[0]?.indexdef).toMatch(/available_at, occurred_at, id/i);
  });

  it("round-trips an event through claim and markProcessed", async () => {
    const userId = user("roundtrip");
    const e = createDomainEvent("balance.recorded", {
      userId,
      aggregateId: asAccountId("acct-1"),
      occurredAt: new Date(Date.now() - 5_000),
      correlationId: "req-42",
      payload: {
        accountId: asAccountId("acct-1"),
        providerId: "united",
        points: 10,
        previousPoints: null,
        source: "manual",
        capturedAt: new Date().toISOString(),
      },
    });
    await publisher.publish([e]);

    const claimed = (
      await store.claim({ limit: 1000, now: new Date(), leaseMs: 60_000, maxAttempts: 5 })
    ).find((c) => c.event.id === e.id);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.event).toEqual(e);

    // Leased: a second claim does not see it.
    const again = await store.claim({ limit: 1000, now: new Date(), leaseMs: 60_000, maxAttempts: 5 });
    expect(again.find((c) => c.event.id === e.id)).toBeUndefined();

    await store.markProcessed(e.id, new Date());
    const [row] = await rowsFor(userId);
    expect(row?.processedAt).toBeInstanceOf(Date);
    expect(row?.correlationId).toBe("req-42");
  });

  it("retries notifier failures and persists only safe references through dead-lettering", async () => {
    const userId = user("retry");
    const e = ev(userId);
    await publisher.publish([e]);
    let now = new Date();
    const seen: string[] = [];
    const secret = "private-notification-and-webhook-sentinel";
    let bodyReads = 0;
    const notifier = new SlackWebhookNotifier(`https://hooks.slack/${secret}`, async () => ({
      ok: false, status: 500, text: async () => { bodyReads += 1; return secret; },
    }));
    const registry = new EventHandlerRegistry().on("*", {
      name: "always-fails",
      handle: async (event) => {
        if (event.userId === userId) {
          seen.push(event.id);
          await notifier.notify({ text: secret });
        }
      },
    });
    const dead: string[] = [];
    const failures: string[] = [];
    const processor = new OutboxProcessor(store, registry, {
      clock: { now: () => now },
      maxAttempts: 3,
      baseBackoffMs: 1000,
      onDeadLetter: (info) => {
        if (info.event.userId === userId) { dead.push(info.event.id); failures.push(info.error); }
      },
    });

    await processor.runOnce();
    let [row] = await rowsFor(userId);
    expect(row).toMatchObject({ attempts: 1, lastError: expect.stringMatching(/^OUTBOX_DELIVERY_FAILED:[0-9a-f-]{36}$/) });
    const retryFailure = row!.lastError;
    expect(row!.lastError).not.toContain(secret);
    expect(row!.availableAt.getTime()).toBe(now.getTime() + 1000);
    expect(row!.processedAt).toBeNull();

    await processor.runOnce(); // still backing off
    expect(seen).toHaveLength(1);

    now = new Date(now.getTime() + 1000);
    await processor.runOnce();
    now = new Date(now.getTime() + 2000);
    await processor.runOnce();
    expect(seen).toHaveLength(3);
    [row] = await rowsFor(userId);
    expect(row).toMatchObject({ attempts: 3, lastError: expect.stringMatching(/^OUTBOX_DELIVERY_FAILED:[0-9a-f-]{36}$/) });
    expect(row!.deadLetteredAt).toBeInstanceOf(Date);
    expect(dead).toEqual([e.id]);
    expect(failures).toEqual([row!.lastError]);
    expect(row!.lastError).not.toBe(retryFailure);
    expect(JSON.stringify([row!.lastError, failures])).not.toContain(secret);
    expect(bodyReads).toBe(0);

    now = new Date(now.getTime() + 86_400_000);
    await processor.runOnce();
    expect(seen).toHaveLength(3);
    expect(await store.countDeadLettered()).toBeGreaterThanOrEqual(1);
  });

  it("reclaims a row whose worker died (lease expiry) and dead-letters exhausted ones", async () => {
    const userId = user("lease");
    await publisher.publish([ev(userId, 1), ev(userId, 2)]);
    const t0 = new Date();
    const first = await store.claim({ limit: 1000, now: t0, leaseMs: 1000, maxAttempts: 2 });
    const mine = first.filter((c) => c.event.userId === userId);
    expect(mine).toHaveLength(2);
    // "Crash": nothing recorded. Within the lease nothing is claimable.
    expect(
      (await store.claim({ limit: 1000, now: t0, leaseMs: 1000, maxAttempts: 2 })).filter(
        (c) => c.event.userId === userId,
      ),
    ).toHaveLength(0);
    const t1 = new Date(t0.getTime() + 2000);
    const second = await store.claim({ limit: 1000, now: t1, leaseMs: 1000, maxAttempts: 2 });
    expect(second.filter((c) => c.event.userId === userId).map((c) => c.attempts)).toEqual([2, 2]);
    // Final attempt also crashed: they are exhausted and get parked.
    const t2 = new Date(t1.getTime() + 2000);
    expect(await store.deadLetterExhausted(2, t2)).toBeGreaterThanOrEqual(2);
    const rows = await rowsFor(userId);
    expect(rows.every((r) => r.deadLetteredAt !== null)).toBe(true);
  });

  it("concurrent workers never process an event twice", async () => {
    const userId = user("concurrent");
    const total = 120;
    await publisher.publish(Array.from({ length: total }, (_, i) => ev(userId, i)));

    const handled = new Map<string, number>();
    const makeWorker = (name: string) => {
      const registry = new EventHandlerRegistry().on("*", {
        name,
        handle: async (event) => {
          if (event.userId !== userId) return;
          handled.set(event.id, (handled.get(event.id) ?? 0) + 1);
          await new Promise((r) => setTimeout(r, 1));
        },
      });
      // Separate connection per worker, like separate processes.
      const workerStore = new DrizzleOutboxStore(createDb(url!));
      return new OutboxProcessor(workerStore, registry, { batchSize: 7 });
    };
    const workers = Array.from({ length: 6 }, (_, i) => makeWorker(`w${i}`));
    await Promise.all(workers.map((w) => w.drain()));

    expect(handled.size).toBe(total);
    expect([...handled.values()].every((n) => n === 1)).toBe(true);
    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.processedAt !== null && r.attempts === 1)).toBe(true);
  });

  describe("atomicity with state", () => {
    function modules() {
      const repos = buildDrizzleRepositories(db, { correlationId: () => "corr-1" });
      const loyalty = buildLoyaltyModule({
        repos,
        gateway: new SimulatedTravelProviderGateway(),
        vault: new NullCredentialVault(),
        fx: new StaticFxRateSource(),
        scraper: new StubPageScraper(),
        llm: new HeuristicAssistant(),
      });
      return { repos, loyalty, agent: buildAgentModule({ repos, recordManualBalance: loyalty.recordManualBalance, linkLoyaltyAccount: loyalty.linkLoyaltyAccount }) };
    }

    it("commits state, activity and events together", async () => {
      const userId = user("commit");
      const { loyalty, repos } = modules();
      const { accountId } = await loyalty.linkLoyaltyAccount.execute({
        userId,
        providerId: "united",
        membershipNumber: "123",
      });
      await loyalty.recordManualBalance.execute({ userId, accountId, points: 500 });
      await loyalty.recordManualBalance.execute({ userId, accountId, points: 700 });
      await loyalty.unlinkLoyaltyAccount.execute(userId, accountId);

      expect(await repos.loyaltyAccounts.findById(accountId)).not.toBeNull();
      const rows = await rowsFor(userId);
      expect(rows.map((r) => r.type).sort()).toEqual(
        ["account.linked", "account.unlinked", "balance.recorded", "balance.recorded"].sort(),
      );
      expect(rows.every((r) => r.correlationId === "corr-1")).toBe(true);
      const recorded = rows.filter((r) => r.type === "balance.recorded");
      expect(recorded.map((r) => (r.payload as { previousPoints: number | null }).previousPoints).sort()).toEqual([500, null].sort());
    });

    it("rolls back state, activity and events when the event write fails", async () => {
      const userId = user("rollback");
      const repos = buildDrizzleRepositories(db);
      const failing = {
        unitOfWork: repos.eventing!.unitOfWork,
        publisher: {
          publish: async (events: readonly DomainEvent[]) => {
            await repos.eventing!.publisher.publish(events); // written inside the tx...
            throw new Error("publish failed after write"); // ...then abort
          },
        },
      };
      const loyalty = buildLoyaltyModule({
        repos: { ...repos, eventing: failing },
        gateway: new SimulatedTravelProviderGateway(),
        vault: new NullCredentialVault(),
        fx: new StaticFxRateSource(),
        scraper: new StubPageScraper(),
        llm: new HeuristicAssistant(),
      });
      await expect(
        loyalty.linkLoyaltyAccount.execute({
          userId,
          providerId: "united",
          membershipNumber: "123",
        }),
      ).rejects.toThrow("publish failed after write");
      expect(await repos.loyaltyAccounts.findByUserId(userId)).toEqual([]);
      expect(await rowsFor(userId)).toHaveLength(0);
      const activity = await repos.activity.findByUserId(userId, 10);
      expect(activity).toHaveLength(0);
    });

    it("emits nothing when the use case fails (duplicate link)", async () => {
      const userId = user("dup");
      const { loyalty } = modules();
      const input = { userId, providerId: "united", membershipNumber: "1" };
      await loyalty.linkLoyaltyAccount.execute(input);
      await expect(loyalty.linkLoyaltyAccount.execute(input)).rejects.toMatchObject({
        code: "DUPLICATE_LOYALTY_ACCOUNT",
      });
      expect(await rowsFor(userId)).toHaveLength(1);
    });

    it("consent grant (nested transaction) and revoke emit events", async () => {
      const userId = user("consent");
      const { repos } = modules();
      const grant = new GrantConsent(repos.consents, undefined, repos.eventing);
      const first = await grant.execute({ userId, providerId: "united" });
      const second = await grant.execute({ userId, providerId: "united" });
      await new RevokeConsent(repos.consents, undefined, repos.eventing).execute(
        userId,
        second.id,
      );
      const rows = await rowsFor(userId);
      expect(rows.map((r) => r.type).sort()).toEqual([
        "consent.granted",
        "consent.granted",
        "consent.revoked",
      ]);
      expect(rows.map((r) => r.aggregateId)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );
    });

    it("held reading, confirm: balance, observation row and events commit together", async () => {
      const userId = user("review");
      const { loyalty, agent } = modules();
      await agent.grantConsent.execute({ userId, providerId: "united" });
      const base = {
        userId,
        skillId: "united.capture-balance",
        sourceUrl: "https://www.united.com/en/us/myunited",
        agent: "it",
        canLinkAccount: true,
        membershipNumber: "m1",
      };
      await agent.submitObservation.execute({ ...base, points: 1000 });
      const held = await agent.submitObservation.execute({ ...base, points: 900_000 });
      expect(held.outcome).toBe("needs_review");
      await agent.resolveObservationReview.confirm(userId, held.reviewId!);
      const history = await loyalty.getBalanceHistory.execute(userId, held.accountId);
      expect(history.map((h) => h.points)).toEqual([900_000, 1000]);
      const types = (await rowsFor(userId)).map((r) => r.type);
      expect(types.filter((t) => t === "observation.held")).toHaveLength(1);
      expect(types.filter((t) => t === "observation.confirmed")).toHaveLength(1);
      expect(types.filter((t) => t === "balance.recorded")).toHaveLength(2);
      await expect(
        agent.resolveObservationReview.confirm(userId, held.reviewId!),
      ).rejects.toMatchObject({ code: "REVIEW_ALREADY_RESOLVED" });
      expect((await rowsFor(userId)).filter((r) => r.type === "observation.confirmed")).toHaveLength(1);
    });
  });

  it("unit of work joins nested runs and isolates concurrent ones", async () => {
    const uow = new DrizzleUnitOfWork(db);
    const pub = new DrizzleEventPublisher(uow.db);
    const a = user("uow-a");
    const b = user("uow-b");
    await Promise.all([
      uow
        .run(async () => {
          await pub.publish([ev(a, 1)]);
          await uow.run(async () => pub.publish([ev(a, 2)]));
          throw new Error("abort a");
        })
        .catch(() => undefined),
      uow.run(async () => pub.publish([ev(b, 1)])),
    ]);
    expect(await rowsFor(a)).toHaveLength(0);
    expect(await rowsFor(b)).toHaveLength(1);
  });
});
