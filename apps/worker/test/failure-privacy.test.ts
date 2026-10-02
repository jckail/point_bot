import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserId, LoyaltyAccountId, ObservationId, createAwardWatch, createDomainEvent, computePortfolioSummary, InvalidBalanceError, type LoyaltyAccountReadModel, type PortfolioDigestReadModel, type OutboxStore } from "@pointup/core";
import type { WorkerContainer } from "../src/container";
import { finishWorkerJob, reportFailure } from "../src/failures";
import { runLoop } from "../src/jobs/loop";
import { sendDigests } from "../src/jobs/send-digests";
import { sendAlerts } from "../src/jobs/send-alerts";
import { checkWatches } from "../src/jobs/check-watches";
import { syncAllUsers } from "../src/jobs/sync-all-users";
import { processOutbox } from "../src/jobs/outbox";
import { purge } from "../src/jobs/purge";
import { loadEnv } from "../src/env";

const secret = "PRIVATE_provider_body_token_recipient@example.test";
const userId = UserId.parse(`user_${secret}`);
const failure = new Error(secret, { cause: { token: secret } });
const account: LoyaltyAccountReadModel = {
  id: LoyaltyAccountId.generate(),
  provider: { id: "air-canada-aeroplan", kind: "airline", displayName: secret, pointsCurrency: "points", estimatedCentsPerPoint: 1, inactivityExpiryMonths: 12 },
  membershipNumber: secret, hasStoredCredential: true,
  latestBalance: { points: 50, source: "manual", capturedAt: new Date() },
  estimatedValueCents: 50, customCentsPerPoint: null,
  trend: { sincePrevious: null, since30Days: null, since90Days: null },
  expiresAt: new Date(), daysUntilExpiry: 1, notes: secret, tags: [], pinnedAt: null, createdAt: new Date(),
};
const digest: PortfolioDigestReadModel = { userId, accounts: [account], summary: computePortfolioSummary([account]), goals: [], expiring: [] };
function container(useCases: object): WorkerContainer {
  return { accounts: { listUserIds: async () => [userId] }, useCases } as unknown as WorkerContainer;
}
const directory = { getEmail: vi.fn(async () => secret) };
const mailer = { send: vi.fn(async () => { throw failure; }) };
const notifier = { notify: vi.fn(async () => { throw failure; }) };
let lines: string[];
function logs() { return lines.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>); }
function assertPrivate() {
  expect(lines.join("\n")).not.toContain(secret);
  for (const log of logs().filter((log) => log.level === "error")) {
    expect(Object.keys(log).sort()).toEqual(["category", "failureRef", "job", "level", ...(log.code ? ["code"] : [])].sort());
    expect(log.failureRef).toMatch(/^[a-f0-9-]{36}$/);
  }
}
beforeEach(() => {
  lines = [];
  for (const method of ["info", "log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  directory.getEmail.mockClear(); mailer.send.mockClear(); notifier.notify.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("worker failure boundaries", () => {
  it("terminal runner preserves success/failure exits without echoing exception or job input", async () => {
    const exit = vi.fn();
    await finishWorkerJob(async () => { throw failure; }, secret, exit);
    expect(exit).toHaveBeenLastCalledWith(1);
    await finishWorkerJob(async () => {}, "sync", exit);
    expect(exit).toHaveBeenLastCalledWith(0);
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ category: "job_failed", job: "unknown" });
    assertPrivate();
  });
  it("terminal failure still exits nonzero when the diagnostic sink throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { throw failure; });
    const exit = vi.fn();
    await finishWorkerJob(async () => { throw failure; }, "sync", exit);
    expect(exit).toHaveBeenCalledWith(1);
  });
  it("retains only closed public codes without invoking hostile diagnostic getters", () => {
    reportFailure("job_failed", "sync", Object.assign(new InvalidBalanceError(), { message: secret }));
    const get = vi.fn(() => { throw failure; });
    reportFailure("job_failed", "sync", { get code() { return get(); }, toJSON: get, message: secret });
    reportFailure("job_failed", "sync", { code: secret });
    expect(get).not.toHaveBeenCalled();
    expect(logs().map((log) => log.code)).toEqual(["INVALID_BALANCE", undefined, undefined]);
    assertPrivate();
  });
  it("scheduler continues after rejection and shuts down cleanly", async () => {
    vi.useFakeTimers();
    const priorTerm = process.listeners("SIGTERM"); const priorInt = process.listeners("SIGINT");
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    try {
      const loop = runLoop([{ name: secret, everyMs: 100, run }], { initialDelayMs: 0 });
      await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(100);
      expect(run).toHaveBeenCalledTimes(2);
      process.emit("SIGTERM"); await loop; await vi.advanceTimersByTimeAsync(100);
      expect(run).toHaveBeenCalledTimes(2);
      expect(logs()[0]).toMatchObject({ category: "scheduled_job_failed", job: "unknown" }); assertPrivate();
    } finally {
      for (const listener of process.listeners("SIGTERM")) if (!priorTerm.includes(listener)) process.removeListener("SIGTERM", listener);
      for (const listener of process.listeners("SIGINT")) if (!priorInt.includes(listener)) process.removeListener("SIGINT", listener);
    }
  });
  it("digest chat failure still attempts email; email failure rejects to terminal path", async () => {
    const host = container({ buildPortfolioDigest: { execute: async () => digest } });
    await finishWorkerJob(() => sendDigests(host, directory, mailer, notifier), "digest", vi.fn());
    expect(mailer.send).toHaveBeenCalledOnce();
    expect(logs().map((log) => log.category)).toEqual(["chat_delivery_failed", "job_failed"]); assertPrivate();
  });
  it("directory failure skips digest email without aborting", async () => {
    await sendDigests(container({ buildPortfolioDigest: { execute: async () => digest } }), { getEmail: async () => { throw failure; } }, mailer);
    expect(mailer.send).not.toHaveBeenCalled(); expect(logs()[0]).toMatchObject({ category: "directory_lookup_failed" }); assertPrivate();
  });
  it("alert chat and email failures remain independent and nonfatal", async () => {
    await sendAlerts(container({ buildPortfolioDigest: { execute: async () => digest } }), directory, mailer, notifier);
    expect(mailer.send).toHaveBeenCalledOnce(); expect(logs().map((log) => log.category)).toEqual(["chat_delivery_failed", "email_delivery_failed"]); assertPrivate();
  });
  it("watch chat and email failures remain nonfatal", async () => {
    const watch = createAwardWatch({ userId, url: "https://example.test", label: secret, minCentsPerPoint: 1 });
    await checkWatches(container({ checkAwardWatches: { execute: async () => ({ checked: 1, failed: 0, hits: [{ watch, bestRealizedCpp: 2, bestDealTitle: secret, pageTitle: secret }] }) } }), directory, mailer, notifier);
    expect(mailer.send).toHaveBeenCalledOnce(); expect(logs().map((log) => log.category)).toEqual(["chat_delivery_failed", "email_delivery_failed"]); assertPrivate();
  });
  it("sync outcomes continue without arbitrary codes or identities", async () => {
    const execute = vi.fn(async () => [{ ok: false, accountId: secret, errorCode: secret }, { ok: false, accountId: secret, errorCode: "SCRAPE_FAILED" }, { ok: true, accountId: secret }]);
    await syncAllUsers(container({ syncAllLoyaltyAccounts: { execute } }));
    expect(execute).toHaveBeenCalledOnce(); expect(logs().map((log) => log.code)).toEqual([undefined, "SCRAPE_FAILED"]);
    expect(lines).toContain("[sync] done: 1 synced, 2 skipped/failed"); assertPrivate();
  });
  it.each([1, 2])("outbox attempt %s preserves retry/dead-letter persistence without console leakage", async (attempts) => {
    const event = createDomainEvent("observation.held", { userId, aggregateId: ObservationId.generate(), payload: { accountId: account.id, providerId: "aeroplan", points: 50, previousPoints: 100, reviewExpiresAt: new Date().toISOString() }, occurredAt: new Date() });
    const outbox: OutboxStore = { claim: vi.fn(async () => [{ event, attempts, leaseUntil: new Date(Date.now() + 60_000) }]), deadLetterExhausted: async () => 0, markProcessed: vi.fn(async () => true), scheduleRetry: vi.fn(async () => true), deadLetter: vi.fn(async () => true) };
    const result = await processOutbox({ outbox }, notifier, { maxAttempts: 2 });
    expect(result).toMatchObject({ processed: 0, retried: attempts === 1 ? 1 : 0, deadLettered: attempts === 2 ? 1 : 0 });
    expect(attempts === 1 ? outbox.scheduleRetry : outbox.deadLetter).toHaveBeenCalledOnce(); expect(outbox.markProcessed).not.toHaveBeenCalled(); assertPrivate();
  });
  it("successful outbox dispatch is not retried when its telemetry sink throws", async () => {
    vi.spyOn(console, "log").mockImplementation(() => { throw failure; });
    const event = createDomainEvent("observation.held", {
      userId, aggregateId: ObservationId.generate(), occurredAt: new Date(),
      payload: { accountId: account.id, providerId: "air-canada-aeroplan", points: 50, previousPoints: 100, reviewExpiresAt: new Date().toISOString() },
    });
    const outbox: OutboxStore = {
      claim: async () => [{ event, attempts: 1, leaseUntil: new Date(Date.now() + 60_000) }], deadLetterExhausted: async () => 0,
      markProcessed: vi.fn(async () => true), scheduleRetry: vi.fn(async () => true), deadLetter: vi.fn(async () => true),
    };
    const result = await processOutbox({ outbox }, null);
    expect(result).toEqual({ claimed: 1, processed: 1, retried: 0, deadLettered: 0 });
    expect(outbox.markProcessed).toHaveBeenCalledOnce();
    expect(outbox.scheduleRetry).not.toHaveBeenCalled(); expect(outbox.deadLetter).not.toHaveBeenCalled();
    assertPrivate();
  });
  it("purge reports failed target privately and still visits all targets", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test"); const seen: string[] = [];
    await expect(purge({ retention: { purgeBatch: async (target) => { seen.push(target); if (target === "outbox") throw failure; return 0; } } }, loadEnv())).rejects.toThrow("purge failed for: outbox");
    expect(seen).toEqual(["outbox", "activity", "access_tokens", "consents"]); expect(lines.join("\n")).not.toContain(secret);
    expect(logs()[0]).toMatchObject({ targets: { outbox: { failed: true } } });
  });
});
