import { describe, expect, it, vi } from "vitest";
import { PlanRedemption } from "../src/application/loyalty/plan-redemption";
import { ListActiveTransferBonuses, RecordTransferBonus } from "../src/application/loyalty/transfer-bonuses";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { SWEET_SPOTS } from "../src/domain/loyalty/catalog/sweet-spots";
import type { AwardSearchStatus } from "../src/domain/loyalty/award-availability";
import { InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository, InMemoryTransferBonusRepository } from "./fakes";
import { asUserId } from "./ids";

const START = new Date("2026-10-02T12:00:00Z"), COMPLETE = new Date("2026-10-02T12:00:02Z"), EDGE_TIME = new Date("2026-10-02T12:00:01Z");
const owner = asUserId("completion-owner");
const query = { origin: "JFK", destination: "NRT", dateFrom: "2026-12-03", dateTo: "2026-12-03", cabin: "economy" as const };
function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }
async function fixture(status: AwardSearchStatus = "ok") {
  let now = START;
  const clock = { now: () => now }, accounts = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository(), bonuses = new InMemoryTransferBonusRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "amex-membership-rewards", membershipNumber: "PRIVATE_MEMBER", notes: "PRIVATE_NOTE", now });
  await accounts.insert(account);
  await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 4000, source: "manual", capturedAt: now }));
  const spot = SWEET_SPOTS.find(item => item.programId === "air-canada-aeroplan" && item.kind === "flight")!;
  expect(spot.pointsCost).toBe(5000);
  const started = gate(), paused = gate();
  const searchAwards = vi.fn(async () => {
    started.release(); await paused.wait;
    return { status, checkedAt: now, message: status === "ok" ? null : "Controlled unavailable source", options: status === "ok" ? [{ programId: "air-canada-aeroplan", carrier: "AC", date: query.dateFrom, cabin: query.cabin, pointsCost: 5000, taxesCents: 500, seats: 1 }] : [] };
  });
  const list = new ListLoyaltyAccounts(accounts, balances, clock), active = new ListActiveTransferBonuses(bonuses, clock);
  const planner = new PlanRedemption(list, active, { searchAwards }, clock, [spot]);
  const input = { userId: owner, goal: { kind: "flight" as const, targetProgramId: spot.programId, quantity: 1 }, award: query };
  async function record(startsAt: Date, endsAt: Date, createdBy = owner, multiplierPermille = 1500) {
    return new RecordTransferBonus(bonuses, clock).execute({ fromProviderId: account.providerId, toProviderId: spot.programId, source: "user", createdBy, multiplierPermille, startsAt, endsAt, sourceUrl: createdBy === owner ? null : "https://synthetic.example/PRIVATE_FOREIGN_BONUS" });
  }
  return { account, accounts, balances, bonuses, list, active, planner, input, record, searchAwards, started, paused, clock, setTime: (date: Date) => { now = date; } };
}
describe("completion-time transfer bonuses", () => {
  it("an expiring bonus cannot make a delayed award-search plan fundable", async () => {
    const f = await fixture(); await f.record(new Date("2026-10-01T00:00:00Z"), EDGE_TIME);
    const request = f.planner.execute(f.input); await f.started.wait; f.setTime(COMPLETE); f.paused.release();
    const result = await request;
    expect(result).toMatchObject({ activeBonusCount: 0, generatedAt: COMPLETE.toISOString(), availability: { status: "ok", checkedAt: COMPLETE.toISOString() } });
    expect(result.plans[0]).toMatchObject({ status: "shortfall", destinationPointsNeeded: 5000, destinationPointsProvided: 4000, shortfall: { pointsNeeded: 1000 } });
    expect(result.plans[0]?.sources.every(source => source.bonus === null)).toBe(true);
    expect(result.plans[0]?.availability?.options[0]?.programId).toBe("air-canada-aeroplan");
  });
  it("includes newly active owner bonuses after the wait, keeping foreign reports private", async () => {
    const f = await fixture(), find = vi.spyOn(f.bonuses, "findActive");
    const own = await f.record(EDGE_TIME, new Date("2026-10-03T00:00:00Z"));
    await f.record(EDGE_TIME, new Date("2026-10-03T00:00:00Z"), asUserId("PRIVATE_FOREIGN_REPORTER"), 3000);
    const request = f.planner.execute(f.input); await f.started.wait;
    expect(find).not.toHaveBeenCalled(); f.setTime(COMPLETE); f.paused.release();
    const result = await request;
    expect(find).toHaveBeenCalledOnce(); expect(find).toHaveBeenCalledWith(COMPLETE);
    expect(result).toMatchObject({ activeBonusCount: 1, generatedAt: COMPLETE.toISOString() });
    expect(result.plans[0]).toMatchObject({ status: "fundable", shortfall: null, sources: [expect.objectContaining({ destinationPoints: 6000, bonus: expect.objectContaining({ id: own.id, multiplierPermille: 1500, verified: false }), eligibility: expect.objectContaining({ evaluatedAt: COMPLETE.toISOString() }) })] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_MEMBER|PRIVATE_NOTE|PRIVATE_FOREIGN/);
  });
  it.each(["error", "not_configured"] as const)("still evaluates at completion and preserves source status %s", async status => {
    const f = await fixture(status); await f.record(new Date("2026-10-01T00:00:00Z"), EDGE_TIME);
    const request = f.planner.execute(f.input); await f.started.wait; f.setTime(COMPLETE); f.paused.release();
    const result = await request;
    expect(result).toMatchObject({ activeBonusCount: 0, generatedAt: COMPLETE.toISOString(), availability: { status } });
    expect(result.plans[0]).toMatchObject({ status: "shortfall", availability: null });
  });
  it("reads the actual selected card after award search instead of using a stale eligible card", async () => {
    const f = await fixture();
    const chase = createLoyaltyAccount({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: "chase-sapphire-preferred", now: START });
    await f.accounts.insert(chase); await f.balances.insert(createBalanceSnapshot({ loyaltyAccountId: chase.id, points: 40000, source: "manual", capturedAt: START }));
    const spot = SWEET_SPOTS.find(item => item.programId === "hyatt")!;
    const planner = new PlanRedemption(f.list, f.active, { searchAwards: f.searchAwards }, f.clock, [spot]);
    const request = planner.execute({ userId: owner, goal: { kind: "any", targetProgramId: "hyatt", quantity: 1 }, award: query });
    await f.started.wait;
    await f.accounts.update({ ...chase, cardProductId: "chase-sapphire-reserve" }, { cardProductId: "chase-sapphire-reserve" });
    f.setTime(COMPLETE); f.paused.release(); const result = await request;
    expect(result.eligibilityWarnings).toContainEqual(expect.objectContaining({ code: "CARD_PRODUCT_UNVERIFIED", toProviderId: "hyatt", cardProductId: "chase-sapphire-reserve" }));
    expect(result.plans[0]?.status).toBe("shortfall");
    expect(result.plans[0]?.sources.some(source => source.providerId === chase.providerId)).toBe(false);
  });
  it("preserves no-award and hotel paths without an external search or duplicate bonus query", async () => {
    const f = await fixture(), find = vi.spyOn(f.bonuses, "findActive");
    expect((await f.planner.execute({ userId: owner, goal: f.input.goal })).availability).toBeNull();
    expect((await f.planner.execute({ userId: owner, goal: { kind: "hotel" }, award: query })).availability).toBeNull();
    expect(f.searchAwards).not.toHaveBeenCalled(); expect(find).toHaveBeenCalledTimes(2);
  });
  it("active listing filters a bonus that expires while its database query is pending", async () => {
    const f = await fixture(); const bonus = await f.record(new Date("2026-10-01T00:00:00Z"), EDGE_TIME);
    const started = gate(), paused = gate();
    const read = f.bonuses.findActive.bind(f.bonuses);
    vi.spyOn(f.bonuses, "findActive").mockImplementation(async at => { const snapshot = await read(at); started.release(); await paused.wait; return snapshot; });
    const request = f.active.execute(owner); await started.wait; f.setTime(COMPLETE); paused.release();
    expect(await request).toEqual([]); expect(await f.bonuses.findById(bonus.id)).toBe(bonus);
  });
  it("filters bonuses again when accounts finish after the already-resolved bonus list expires", async () => {
    const f = await fixture(); const bonus = await f.record(new Date("2026-10-01T00:00:00Z"), EDGE_TIME);
    const accountsStarted = gate(), accountsPaused = gate(), bonusesFinished = gate();
    const readAccounts = f.list.execute.bind(f.list), readBonuses = f.active.execute.bind(f.active);
    vi.spyOn(f.list, "execute").mockImplementation(async userId => {
      const accounts = await readAccounts(userId); accountsStarted.release(); await accountsPaused.wait; return accounts;
    });
    vi.spyOn(f.active, "execute").mockImplementation(async userId => {
      const active = await readBonuses(userId); expect(active).toEqual([bonus]); bonusesFinished.release(); return active;
    });
    const request = f.planner.execute({ userId: owner, goal: f.input.goal });
    await Promise.all([accountsStarted.wait, bonusesFinished.wait]);
    f.setTime(COMPLETE); accountsPaused.release(); const result = await request;
    expect(result).toMatchObject({ activeBonusCount: 0, generatedAt: COMPLETE.toISOString(), availability: null });
    expect(result.plans[0]).toMatchObject({ status: "shortfall", destinationPointsProvided: 4000, shortfall: { pointsNeeded: 1000 } });
    expect(result.plans[0]?.sources[0]).toMatchObject({ bonus: null, eligibility: { evaluatedAt: COMPLETE.toISOString() } });
    expect(f.searchAwards).not.toHaveBeenCalled();
  });
  it("preserves inclusive window endpoints and excludes the next millisecond", async () => {
    const f = await fixture(); const bonus = await f.record(START, EDGE_TIME);
    expect(await f.active.execute(owner)).toEqual([bonus]);
    f.setTime(EDGE_TIME); expect(await f.active.execute(owner)).toEqual([bonus]);
    f.setTime(new Date(EDGE_TIME.getTime() + 1)); expect(await f.active.execute(owner)).toEqual([]);
  });
});
