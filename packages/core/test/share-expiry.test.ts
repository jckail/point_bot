import { describe, expect, it, vi } from "vitest";
import { CreatePortfolioShare, GetPublicPortfolioSnapshot, RevokePortfolioShare } from "../src/application/loyalty/portfolio-share";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createPortfolioShare, isShareActive } from "../src/domain/loyalty/portfolio-share";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { ShareId } from "../src/domain/shared/ids";
import { createPortfolioShareRequestSchema, httpStatusForErrorCode } from "../src/contracts";
import { InMemoryPortfolioShareRepository, InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository } from "./fakes";
import { asUserId } from "./ids";
const START = new Date("2026-10-02T12:00:00Z"), owner = asUserId("PRIVATE_SHARE_OWNER");
function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }
async function fixture() {
  let now = START;
  const clock = { now: () => now }, shares = new InMemoryPortfolioShareRepository();
  const accounts = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "united", membershipNumber: "PRIVATE_SHARE_MEMBER", credentialRef: "PRIVATE_SHARE_CREDENTIAL", notes: "PRIVATE_SHARE_NOTE", tags: ["private-share-tag"], now });
  await accounts.insert(account);
  await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 12345, source: "manual", capturedAt: now }));
  const share = await new CreatePortfolioShare(shares, clock).execute({ userId: owner, label: "Friends", expiresInDays: 1 });
  const list = new ListLoyaltyAccounts(accounts, balances, clock), entered = gate(), paused = gate();
  const read = list.execute.bind(list);
  vi.spyOn(list, "execute").mockImplementation(async userId => { entered.release(); await paused.wait; return read(userId); });
  const service = new GetPublicPortfolioSnapshot(shares, list, clock);
  const request = () => service.execute(share.token).then(value => ({ value }), error => ({ error }));
  return { shares, share, entered, paused, clock, request, setTime: (date: Date) => { now = date; } };
}
describe("share lifetime boundaries", () => {
  it.each([-1, 0, 0.5, 366, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects invalid days %s before insertion in core and wire contracts", async days => {
    const repo = new InMemoryPortfolioShareRepository(), insert = vi.spyOn(repo, "insert");
    await expect(new CreatePortfolioShare(repo, { now: () => START }).execute({ userId: owner, expiresInDays: days })).rejects.toMatchObject({ code: "INVALID_SHARE_EXPIRY" });
    expect(insert).not.toHaveBeenCalled();
    expect(createPortfolioShareRequestSchema.safeParse({ expiresInDays: days }).success).toBe(false);
    expect(httpStatusForErrorCode("INVALID_SHARE_EXPIRY")).toBe(400);
  });
  it.each([undefined, null, 1, 365])("preserves explicit no-expiry and valid whole-day lifetime %s", async days => {
    const repo = new InMemoryPortfolioShareRepository();
    const result = await new CreatePortfolioShare(repo, { now: () => START }).execute({ userId: owner, expiresInDays: days });
    expect(result.expiresAt).toEqual(days == null ? null : new Date(START.getTime() + days * 86400000));
    expect(result.active).toBe(true);
    expect(createPortfolioShareRequestSchema.safeParse({ expiresInDays: days }).success).toBe(true);
  });
  it("invalid stored dates or clocks cannot authorize a public share", () => {
    const valid = createPortfolioShare({ userId: owner, now: START });
    expect(isShareActive({ ...valid, expiresAt: new Date(NaN) }, START)).toBe(false);
    expect(isShareActive(valid, new Date(NaN))).toBe(false);
    expect(() => createPortfolioShare({ userId: owner, expiresAt: new Date(NaN), now: START })).toThrow("Share expiry");
  });
});
describe("public share authorization after portfolio reads", () => {
  it("denies a link revoked while its actual private portfolio is loading", async () => {
    const f = await fixture(), request = f.request(); await f.entered.wait;
    await new RevokePortfolioShare(f.shares, f.clock).execute(owner, f.share.id);
    f.paused.release(); expect(await request).toMatchObject({ error: { code: "SHARE_LINK_NOT_FOUND" } });
  });
  it.each([0, 1])("denies expiry at or after the exact deadline while loading: %sms", async extra => {
    const f = await fixture(), request = f.request(); await f.entered.wait;
    f.setTime(new Date(f.share.expiresAt!.getTime() + extra)); f.paused.release();
    expect(await request).toMatchObject({ error: { code: "SHARE_LINK_NOT_FOUND" } });
  });
  it("checks the clock after the final token read finishes", async () => {
    const f = await fixture(), finalRead = gate(), finishRead = gate();
    const read = f.shares.findByToken.bind(f.shares); let reads = 0;
    vi.spyOn(f.shares, "findByToken").mockImplementation(async token => {
      if (++reads === 2) { finalRead.release(); await finishRead.wait; }
      return read(token);
    });
    const request = f.request(); await f.entered.wait; f.paused.release(); await finalRead.wait;
    f.setTime(f.share.expiresAt!); finishRead.release();
    expect(await request).toMatchObject({ error: { code: "SHARE_LINK_NOT_FOUND" } });
  });
  it.each(["owner", "identity", "token", "deleted"] as const)("denies a changed token %s before exposing the loaded snapshot", async change => {
    const f = await fixture(), request = f.request(); await f.entered.wait;
    const current = (await f.shares.findById(f.share.id))!;
    if (change === "deleted") f.shares.rows.delete(current.id);
    else if (change === "identity") { f.shares.rows.delete(current.id); await f.shares.insert({ ...current, id: ShareId.generate() }); }
    else await f.shares.update({ ...current, ...(change === "owner" ? { userId: asUserId("other-owner") } : { token: "different-token" }) });
    f.paused.release(); expect(await request).toMatchObject({ error: { code: "SHARE_LINK_NOT_FOUND" } });
  });
  it("uses the completion clock and current public label for an unchanged active capability", async () => {
    const f = await fixture(), request = f.request(); await f.entered.wait;
    const completedAt = new Date(START.getTime() + 30000); f.setTime(completedAt);
    await f.shares.update({ ...(await f.shares.findById(f.share.id))!, label: "Current public label" });
    f.paused.release(); const result = await request;
    expect(result).toMatchObject({ value: { accountCount: 1, totalPoints: 12345, label: "Current public label", generatedAt: completedAt } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SHARE_|private-share-tag/);
  });
});
