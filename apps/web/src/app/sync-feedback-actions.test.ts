import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoyaltyAccount, ProviderCredential } from "@pointup/core";

const state = vi.hoisted((): { session: ReturnType<typeof vi.fn>; revalidate: ReturnType<typeof vi.fn>; useCases: Record<string, unknown> } => ({ session: vi.fn(), revalidate: vi.fn(), useCases: {} }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: state.useCases }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
beforeEach(() => { vi.resetAllMocks(); vi.resetModules(); state.useCases = {}; });
afterEach(() => { vi.resetModules(); state.useCases = {}; });
const idle = { status: "idle" } as const;

async function fixture() {
  const core = await import("@pointup/core");
  const fakes = await import("../../../../packages/core/test/fakes");
  const { invalidateOnWrite } = await import("@/server/read-cache");
  const owner = core.UserId.parse("synthetic-sync-owner"), clock = { now: () => new Date("2026-10-03T00:00:00Z") };
  const accounts = new fakes.InMemoryLoyaltyAccountRepository();
  const balances = new fakes.InMemoryBalanceSnapshotRepository();
  const activity = new fakes.InMemoryActivityEventRepository(); const eventing = new fakes.RecordingEventing();
  const united = core.createLoyaltyAccount({ userId: owner, providerId: "united", membershipNumber: "SYNTHETIC_PRIVATE_UNITED", now: clock.now() });
  const marriott = core.createLoyaltyAccount({ userId: owner, providerId: "marriott", membershipNumber: "SYNTHETIC_PRIVATE_MARRIOTT", now: clock.now() });
  await accounts.insert(united); await accounts.insert(marriott);
  const unsupported = new Set<string>();
  const gateway = {
    supports: vi.fn((providerId: string) => !unsupported.has(providerId)),
    fetchBalance: vi.fn(async (account: LoyaltyAccount, _credential: ProviderCredential | null) => ({ points: account.providerId === "united" ? 25000 : 10000 })),
  };
  const syncOne = new core.SyncLoyaltyAccount(accounts, balances, gateway, new fakes.FakeCredentialVault(), activity, clock, eventing);
  const syncAll = new core.SyncAllLoyaltyAccounts(accounts, syncOne);
  const cache = new core.InMemoryCache({ now: () => 0 });
  const list = new core.ListLoyaltyAccounts(accounts, balances, clock, undefined, cache, 1000);
  await list.execute(owner); // Still-warm missing balances must not hide actual successful syncs.
  const invalidate = vi.spyOn(cache, "invalidateTag");
  const executeOne = vi.spyOn(syncOne, "execute"), executeAll = vi.spyOn(syncAll, "execute");
  state.useCases = invalidateOnWrite({ syncLoyaltyAccount: syncOne, syncAllLoyaltyAccounts: syncAll }, cache);
  state.session.mockResolvedValue(owner);
  return { core, owner, accounts, balances, activity, eventing, united, marriott, unsupported, gateway, syncOne, syncAll, executeOne, executeAll, cache, invalidate, list, wrap: invalidateOnWrite };
}
async function reload(f: Awaited<ReturnType<typeof fixture>>) {
  vi.resetModules();
  const current = await import("@pointup/core");
  expect(current.DomainError).not.toBe(f.core.DomainError);
  return { current, ...await import("./actions") };
}
function form(accountId: string) { const data = new FormData(); data.set("accountId", accountId); return data; }
function privateFree(result: unknown) { expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_PRIVATE|op:\/\/|https:\/\/private/); }

describe("actual bulk SyncOutcome feedback", () => {
  it.each(["partial", "all-failed", "all-success"] as const)("reports %s counts from actual core outcomes and committed snapshots", async kind => {
    const f = await fixture();
    if (kind !== "all-success") f.unsupported.add("marriott");
    if (kind === "all-failed") f.unsupported.add("united");
    const actions = await reload(f);
    const result = await actions.syncAllLoyaltyAccountsAction(idle, new FormData());
    const saved = kind === "all-success" ? 2 : kind === "partial" ? 1 : 0;
    expect(result).toEqual(kind === "all-success" ? { status: "success", message: "Updated 2 programs." }
      : { status: "error", message: `Updated ${saved} of 2 programs. ${2 - saved} could not sync. Check their details or record balances manually.` });
    expect(f.balances.rows).toHaveLength(saved); expect(f.eventing.events).toHaveLength(saved);
    expect(f.executeAll).toHaveBeenCalledExactlyOnceWith(f.owner); privateFree(result);
    expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.core.userCacheTag(f.owner));
    expect((await f.list.execute(f.owner)).filter(account => account.latestBalance !== null)).toHaveLength(saved);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("does not claim a successful update when there are no linked accounts", async () => {
    const f = await fixture(); f.accounts.rows.clear(); const actions = await reload(f);
    expect(await actions.syncAllLoyaltyAccountsAction(idle, new FormData())).toEqual({ status: "error", message: "No linked programs to sync." });
    expect(f.gateway.fetchBalance).not.toHaveBeenCalled(); expect(f.balances.rows).toEqual([]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("reports unknown counts when a newly evaluated bulk service receives an old-generation genuine domain error after another worker succeeds", async () => {
    const f = await fixture(); f.unsupported.add("marriott"); const actions = await reload(f);
    // Existing core uses instanceof internally. Mixing retained syncOne with a
    // fresh bulk module therefore does NOT produce a complete outcome array.
    const mixed = new actions.current.SyncAllLoyaltyAccounts(f.accounts, f.syncOne);
    state.useCases = f.wrap({ syncLoyaltyAccount: f.syncOne, syncAllLoyaltyAccounts: mixed }, f.cache);
    const result = await actions.syncAllLoyaltyAccountsAction(idle, new FormData());
    expect(result).toEqual({ status: "error", message: "That program isn't supported yet. Some balances may have changed. Check your portfolio before trying again." });
    expect(JSON.stringify(result)).not.toMatch(/Updated|of 2|SYNTHETIC_PRIVATE/);
    expect(f.balances.rows).toHaveLength(1); expect(f.balances.rows[0]?.loyaltyAccountId).toBe(f.united.id);
    expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.core.userCacheTag(f.owner));
    expect((await f.list.execute(f.owner)).find(account => account.id === f.united.id)?.latestBalance?.points).toBe(25000);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("preserves an unexpected original rejection after another parallel sync commits, invalidating the warm read without inventing counts", async () => {
    const f = await fixture(); const error = new Error("SYNTHETIC_PRIVATE_PROVIDER_BODY https://private.invalid/?credential=secret");
    let firstInserted!: () => void;
    const inserted = new Promise<void>(resolve => { firstInserted = resolve; });
    const insert = f.balances.insert.bind(f.balances);
    vi.spyOn(f.balances, "insert").mockImplementation(async snapshot => { await insert(snapshot); firstInserted(); });
    f.gateway.fetchBalance.mockImplementation(async account => {
      if (account.providerId === "marriott") { await inserted; throw error; }
      return { points: 25000 };
    });
    const actions = await reload(f);
    await expect(actions.syncAllLoyaltyAccountsAction(idle, new FormData())).rejects.toBe(error);
    // Real core awaits already-started workers before propagating: success did
    // persist, although no complete SyncOutcome[] could be returned to the UI.
    expect(f.balances.rows).toHaveLength(1); expect(f.balances.rows[0]?.loyaltyAccountId).toBe(f.united.id);
    expect(f.eventing.events.map(event => event.type)).toEqual(["balance.recorded"]);
    expect(f.invalidate).toHaveBeenCalledExactlyOnceWith(f.core.userCacheTag(f.owner));
    expect((await f.list.execute(f.owner)).find(account => account.id === f.united.id)?.latestBalance?.points).toBe(25000);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });
});

describe("individual sync boundaries and HMR feedback", () => {
  it("returns success only after the actual owned sync wrote and refreshes both relevant pages", async () => {
    const f = await fixture(); const actions = await reload(f);
    expect(await actions.syncLoyaltyAccountAction(idle, form(f.united.id))).toEqual({ status: "success", message: "Balance updated." });
    expect(f.executeOne).toHaveBeenCalledExactlyOnceWith({ userId: f.owner, accountId: f.united.id });
    expect(f.balances.rows).toHaveLength(1); expect(f.balances.rows[0]?.points).toBe(25000);
    expect((await f.list.execute(f.owner)).find(account => account.id === f.united.id)?.latestBalance?.points).toBe(25000);
    expect(state.revalidate.mock.calls).toEqual([["/dashboard"], [`/dashboard/accounts/${f.united.id}`]]);
  });

  it("maps the real retained vault-missing domain failure to fixed guidance without its private credential reference", async () => {
    const f = await fixture();
    await f.accounts.update({ ...f.united, credentialRef: "op://SYNTHETIC_PRIVATE_VAULT/secret-item" });
    const original = f.core.SyncLoyaltyAccount.prototype.execute.bind(f.syncOne); let failure: unknown;
    f.executeOne.mockImplementation(async input => { try { return await original(input); } catch (error) { failure = error; throw error; } });
    const actions = await reload(f);
    const result = await actions.syncLoyaltyAccountAction(idle, form(f.united.id));
    expect(result).toEqual({ status: "error", message: "No credentials available for this program - connect a vault or enter the balance manually." });
    expect(failure).toBeInstanceOf(f.core.CredentialUnavailableError); expect(failure).not.toBeInstanceOf(actions.current.DomainError);
    privateFree(result); expect(f.gateway.fetchBalance).not.toHaveBeenCalled(); expect(f.balances.rows).toEqual([]);
    expect(state.revalidate.mock.calls).toEqual([["/dashboard"], [`/dashboard/accounts/${f.united.id}`]]);
  });

  it("does not expose a foreign account or invoke its provider", async () => {
    const f = await fixture(); const actions = await reload(f); state.session.mockResolvedValue(f.core.UserId.parse("synthetic-foreign-owner"));
    const result = await actions.syncLoyaltyAccountAction(idle, form(f.united.id));
    expect(result).toEqual({ status: "error", message: "We couldn't find that account." });
    privateFree(result); expect(f.gateway.fetchBalance).not.toHaveBeenCalled(); expect(f.balances.rows).toEqual([]);
  });

  it.each(["individual", "bulk"] as const)("gives %s expired-session feedback before invoking core or refreshing", async mode => {
    const f = await fixture(); const actions = await reload(f); state.session.mockResolvedValue(null);
    const result = mode === "individual" ? await actions.syncLoyaltyAccountAction(idle, form(f.united.id))
      : await actions.syncAllLoyaltyAccountsAction(idle, new FormData());
    expect(result).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(f.executeOne).not.toHaveBeenCalled(); expect(f.executeAll).not.toHaveBeenCalled();
    expect(f.invalidate).not.toHaveBeenCalled(); expect(state.revalidate).not.toHaveBeenCalled();
  });
});
