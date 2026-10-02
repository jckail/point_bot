import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Cache } from "@pointup/core";

const state = vi.hoisted((): {
  session: ReturnType<typeof vi.fn>; revalidate: ReturnType<typeof vi.fn>;
  useCases: Record<string, unknown>; cache: Cache | undefined;
} => ({
  session: vi.fn(), revalidate: vi.fn(),
  useCases: {}, cache: undefined,
}));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: state.useCases }) }));
vi.mock("@/server/read-cache", () => ({ getReadCache: () => {
  if (!state.cache) throw new Error("Missing synthetic cache");
  return state.cache;
} }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
beforeEach(() => { vi.resetAllMocks(); vi.resetModules(); state.useCases = {}; state.cache = undefined; });
afterEach(() => { vi.resetModules(); state.useCases = {}; state.cache = undefined; });

async function fixture() {
  const core = await import("@pointup/core");
  const fakes = await import("../../../../packages/core/test/fakes");
  const owner = core.UserId.parse("synthetic-review-owner");
  let instant = new Date("2026-10-03T00:00:00.000Z");
  const clock = { now: () => instant };
  const accounts = new fakes.InMemoryLoyaltyAccountRepository();
  const balances = new fakes.InMemoryBalanceSnapshotRepository();
  const activity = new fakes.InMemoryActivityEventRepository();
  const consents = new fakes.InMemoryConsents();
  const observations = new fakes.InMemoryObservations({ accounts, consents });
  const eventing = new fakes.AtomicObservationEventing({ accounts, balances, activity, observations, consents });
  const record = new core.RecordManualBalance(accounts, balances, activity, clock, eventing);
  const link = new core.LinkLoyaltyAccount(accounts, activity, clock, eventing);
  const grant = new core.GrantConsent(consents, clock, eventing);
  const submit = new core.SubmitObservation(accounts, balances, consents, observations, record, link, clock, eventing);
  const review = new core.ResolveObservationReview(accounts, balances, observations, record, clock, eventing);
  const { accountId } = await link.execute({ userId: owner, providerId: "united", membershipNumber: "SYNTHETIC_PRIVATE_MEMBER" });
  await grant.execute({ userId: owner, providerId: "united", days: 30 });
  const input = { userId: owner, skillId: "united.capture-balance", sourceUrl: "https://www.united.com/account", agent: "synthetic-review", credential: { kind: "session" as const }, sourceMethod: "page_capture" as const };
  await submit.execute({ ...input, points: 50000 });
  instant = new Date(instant.getTime() + 1000);
  const held = await submit.execute({ ...input, points: 5 });
  if (!held.reviewId) throw new Error("Fixture did not hold the implausible reading");
  // Freeze cache time: no TTL expiry can masquerade as action invalidation.
  const cache = new core.InMemoryCache({ now: () => 0 });
  const invalidate = vi.spyOn(cache, "invalidateTag");
  const list = new core.ListLoyaltyAccounts(accounts, balances, clock, undefined, cache, 1000);
  expect((await list.execute(owner))[0]?.latestBalance?.points).toBe(50000);
  expect(await cache.get(`accounts:${owner}`)).toBeDefined();
  state.cache = cache; state.session.mockResolvedValue(owner);
  state.useCases = { resolveObservationReview: review, grantConsent: grant };
  return { core, owner, accountId, accounts, balances, observations, activity, consents, eventing, record, review, grant, cache, invalidate, list, held, reviewId: held.reviewId,
    advance: (ms: number) => { instant = new Date(instant.getTime() + ms); },
  };
}
async function reloadedActions(f: Awaited<ReturnType<typeof fixture>>) {
  // Cached services remain from the earlier module generation, as in the
  // global web container; the action module and its domain imports are new.
  vi.resetModules();
  const current = await import("@pointup/core");
  expect(current.DomainError).not.toBe(f.core.DomainError);
  return { current, ...await import("./agent-actions") };
}
function decisionForm(id: string, decision: string) {
  const data = new FormData(); data.set("reviewId", id); data.set("decision", decision); return data;
}
function grantForm(days: string) {
  const data = new FormData(); data.set("providerId", "united"); data.set("days", days); return data;
}
const noRefresh = () => expect(state.revalidate).not.toHaveBeenCalled();
const idle = { status: "idle" } as const;

describe("review action warm-cache consistency", () => {
  it("confirms through the actual core service and immediately refreshes a still-warm cached account read", async () => {
    const f = await fixture(); const actions = await reloadedActions(f);
    expect(await actions.resolveReviewAction(idle, decisionForm(f.reviewId, "confirm"))).toEqual({ status: "success" });
    expect(f.observations.rows.find(row => row.id === f.held.reviewId)?.outcome).toBe("recorded");
    expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.core.userCacheTag(f.owner));
    expect((await f.list.execute(f.owner))[0]?.latestBalance?.points).toBe(5);
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard/agents");
  });

  it("rejects through the actual core service without a balance write or invented confirmation", async () => {
    const f = await fixture(); const actions = await reloadedActions(f);
    const count = f.balances.rows.length; const write = vi.spyOn(f.record, "executeWithSnapshotId");
    expect(await actions.resolveReviewAction(idle, decisionForm(f.reviewId, "reject"))).toEqual({ status: "success" });
    expect(write).not.toHaveBeenCalled(); expect(f.balances.rows).toHaveLength(count);
    expect(f.observations.rows.find(row => row.id === f.held.reviewId)?.outcome).toBe("rejected");
    expect((await f.list.execute(f.owner))[0]?.latestBalance?.points).toBe(50000);
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard/agents");
  });

  it("invalidates after a committed core confirmation whose adapter acknowledgement fails, without claiming UI success", async () => {
    const f = await fixture();
    const confirm = f.review.confirm.bind(f.review);
    const privateError = new Error("SYNTHETIC_PRIVATE_POSTCOMMIT_DIAGNOSTIC");
    vi.spyOn(f.review, "confirm").mockImplementation(async (owner, id) => { await confirm(owner, id); throw privateError; });
    const actions = await reloadedActions(f);
    await expect(actions.resolveReviewAction(idle, decisionForm(f.reviewId, "confirm"))).rejects.toBe(privateError);
    expect(f.observations.rows.find(row => row.id === f.held.reviewId)?.outcome).toBe("recorded");
    expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.core.userCacheTag(f.owner));
    expect((await f.list.execute(f.owner))[0]?.latestBalance?.points).toBe(5);
    noRefresh(); // Unexpected errors propagate for Next's error boundary, never public feedback.
  });
});

describe("retained core error feedback after action-module reload", () => {
  it.each(["expired", "stale"] as const)("maps actual %s review failures privately, without balance mutation or success refresh", async kind => {
    const f = await fixture();
    if (kind === "expired") f.advance(24 * 3600000);
    else { f.advance(1000); await f.record.execute({ userId: f.owner, accountId: f.accountId, points: 50001 }); }
    const counts = { balances: f.balances.rows.length, activity: f.activity.rows.length, events: f.eventing.events.length };
    const original = f.review.confirm.bind(f.review); let failure: unknown;
    vi.spyOn(f.review, "confirm").mockImplementation(async (owner, id) => {
      try { return await original(owner, id); } catch (error) { failure = error; throw error; }
    });
    const actions = await reloadedActions(f);
    const result = await actions.resolveReviewAction(idle, decisionForm(f.reviewId, "confirm"));
    expect(result).toEqual({ status: "error", message: kind === "expired"
      ? "That reading expired (24 hours). Ask the agent to read the balance again."
      : "This reading no longer matches the account. Reject it and ask the agent to read the balance again." });
    expect(failure).toBeInstanceOf(f.core.DomainError); expect(failure).not.toBeInstanceOf(actions.current.DomainError);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
    expect(f.balances.rows).toHaveLength(counts.balances); expect(f.activity.rows).toHaveLength(counts.activity);
    expect(f.eventing.events).toHaveLength(counts.events);
    expect(f.observations.rows.find(row => row.id === f.held.reviewId)?.outcome).toBe("needs_review");
    expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.core.userCacheTag(f.owner)); noRefresh();
  });

  it("maps actual old-module GrantConsent validation without persisting consent or refreshing", async () => {
    const f = await fixture(); const before = [...f.eventing.events]; const grants = [...f.consents.rows.values()];
    const actions = await reloadedActions(f);
    expect(await actions.grantConsentAction(idle, grantForm("91"))).toEqual({ status: "error", message: "Consent can last between 1 and 90 days." });
    expect(f.consents.rows.size).toBe(grants.length); expect([...f.consents.rows.values()]).toEqual(grants);
    expect(f.eventing.events).toEqual(before); expect(f.invalidate).not.toHaveBeenCalled(); noRefresh();
  });

  it.each(["no-session", "unknown-decision"] as const)("refuses %s before mutation/cache invalidation or UI refresh", async kind => {
    const f = await fixture(); const actions = await reloadedActions(f);
    const confirm = vi.spyOn(f.review, "confirm"), reject = vi.spyOn(f.review, "reject"), grant = vi.spyOn(f.grant, "execute");
    if (kind === "no-session") state.session.mockResolvedValue(null);
    expect(await actions.resolveReviewAction(idle, decisionForm(f.reviewId, kind === "no-session" ? "confirm" : "resend"))).toEqual({ status: "error", message: kind === "no-session" ? "Your session expired - sign in again." : "Unknown decision." });
    if (kind === "no-session") expect(await actions.grantConsentAction(idle, grantForm("30"))).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(confirm).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled(); expect(grant).not.toHaveBeenCalled();
    expect(f.invalidate).not.toHaveBeenCalled(); noRefresh();
  });
});
