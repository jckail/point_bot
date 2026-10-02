import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { OnePasswordConnectVault } from "../src/infrastructure/vault/one-password-connect-vault";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository } from "./fakes";

const ref = "op://vault/item";
const options = { baseUrl: "https://connect.example.invalid/", token: "fixture-token" };
afterEach(() => vi.unstubAllGlobals());

describe("1Password tenant authorization", () => {
  it("denies all stored/request references without a trusted registry", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await new OnePasswordConnectVault(options).resolve(ref, "user-a")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("only resolves exact registered references for the authenticated owner", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ fields: [{ purpose: "USERNAME", value: "fixture-user" }, { purpose: "PASSWORD", value: "fixture-secret" }] }) });
    vi.stubGlobal("fetch", request);
    const vault = new OnePasswordConnectVault({ ...options, authorizedReferences: new Map([["user-a", [ref]]]) });
    expect(await vault.resolve(ref, "user-b")).toBeNull();
    expect(await vault.resolve("op://vault/other", "user-a")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(await vault.resolve(ref, "user-a")).toEqual({ username: "fixture-user", secret: "fixture-secret" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("https://connect.example.invalid/v1/vaults/vault/items/item", expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it("rejects URL control/path characters even if accidentally registered", async () => {
    const invalid = ["op://vault/..", "op://vault/item?redirect=elsewhere", "op://vault/item#fragment", "op://vault/%2e%2e", "op://vault/item/other"];
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const vault = new OnePasswordConnectVault({ ...options, authorizedReferences: new Map([["user-a", invalid]]) });
    for (const reference of invalid) expect(await vault.resolve(reference, "user-a")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("authorizes against the owned account tenant before provider access", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({ userId: "user-b", providerId: "hyatt", membershipNumber: "H1", credentialRef: ref });
    await accounts.insert(account);
    const request = vi.fn();
    const fetchBalance = vi.fn();
    vi.stubGlobal("fetch", request);
    const vault = new OnePasswordConnectVault({ ...options, authorizedReferences: new Map([["user-a", [ref]]]) });
    const sync = new SyncLoyaltyAccount(accounts, balances, { supports: () => true, fetchBalance }, vault);
    await expect(sync.execute({ userId: "user-b", accountId: account.id })).rejects.toMatchObject({ code: "CREDENTIAL_UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
    expect(fetchBalance).not.toHaveBeenCalled();
    expect(balances.rows).toHaveLength(0);
  });
});
