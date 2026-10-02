import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AuthenticateAgentToken, GrantObservationConsent, ListAgentTokens, MintAgentToken, RevokeAgentToken, SubmitAgentObservation } from "../src/application/agents/manage-agents";
import { hashAgentToken, observationHoldReason, prepareObservation, validateAgentToken, type AgentToken, type SubmitObservationInput } from "../src/domain/agents/models";
import type { AgentObservationRepository, AgentTokenRepository, ObservationConsentRepository } from "../src/domain/agents/repositories";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { InMemoryLoyaltyAccountRepository } from "./fakes";
const NOW = new Date("2026-10-01T12:00:00Z");
const clock = { now: () => NOW };
function tokens(): AgentTokenRepository & { rows: Map<string, AgentToken> } {
  const rows = new Map<string, AgentToken>();
  return { rows, insert: async (record) => { rows.set(record.id, record); }, authenticate: async (hash, now, scope) => {
    const record = [...rows.values()].find((row) => row.tokenHash === hash) ?? null;
    validateAgentToken(record, now, scope);
    const used = { ...record, lastUsedAt: now }; rows.set(used.id, used); return used;
  }, findByUserId: async (userId) => [...rows.values()].filter((row) => row.userId === userId), revoke: async (userId, id, now) => {
    const row = rows.get(id); if (!row || row.userId !== userId) return false; rows.set(id, { ...row, revokedAt: row.revokedAt ?? now }); return true;
  } };
}
const payload = (changes: Partial<SubmitObservationInput> = {}): SubmitObservationInput => ({ userId: "owner", tokenId: randomUUID(), observationId: randomUUID(), accountId: randomUUID(), providerId: "united", points: 100, capturedAt: NOW, sourceUrl: "https://www.united.com/account?private=not-stored", sourceMethod: "page_capture", ...changes });

describe("scoped agent invariants", () => {
  it("returns token plaintext once and excludes hashes from all metadata", async () => {
    const repo = tokens();
    const minted = await new MintAgentToken(repo, clock).execute({ userId: "owner", label: "Extension", scopes: ["observations:write", "observations:write"], expiresAt: new Date(NOW.getTime() + 86400_000) });
    expect(minted.token).toMatch(/^pu_[A-Za-z0-9_-]{43}$/);
    const stored = repo.rows.get(minted.metadata.id)!;
    expect(stored.tokenHash).toBe(hashAgentToken(minted.token));
    expect(JSON.stringify(stored)).not.toContain(minted.token);
    expect(minted.metadata.scopes).toEqual(["observations:write"]);
    expect(await new ListAgentTokens(repo).execute("owner")).toEqual([minted.metadata]);
    expect(JSON.stringify(minted.metadata)).not.toContain("tokenHash");
  });
  it("enforces scope, owner revocation, expiry and bounded token lifetime", async () => {
    const repo = tokens(); const mint = new MintAgentToken(repo, clock);
    const minted = await mint.execute({ userId: "owner", label: "Reader", scopes: ["portfolio:read"], expiresAt: new Date(NOW.getTime() + 1000) });
    const auth = new AuthenticateAgentToken(repo, clock);
    expect((await auth.execute(minted.token)).userId).toBe("owner");
    expect(repo.rows.get(minted.metadata.id)?.lastUsedAt).toEqual(NOW);
    await expect(auth.execute(minted.token, "observations:write")).rejects.toMatchObject({ code: "AGENT_SCOPE_DENIED" });
    await expect(new AuthenticateAgentToken(repo, { now: () => new Date(NOW.getTime() + 1000) }).execute(minted.token)).rejects.toMatchObject({ code: "AGENT_TOKEN_INVALID" });
    await expect(new RevokeAgentToken(repo, clock).execute({ userId: "other", tokenId: minted.metadata.id })).rejects.toMatchObject({ code: "AGENT_RECORD_NOT_FOUND" });
    await new RevokeAgentToken(repo, clock).execute({ userId: "owner", tokenId: minted.metadata.id });
    await expect(auth.execute(minted.token)).rejects.toMatchObject({ code: "AGENT_TOKEN_INVALID" });
    await expect(mint.execute({ userId: "owner", label: "Too long", scopes: ["portfolio:read"], expiresAt: new Date(NOW.getTime() + 91 * 86400_000) })).rejects.toMatchObject({ code: "AGENT_VALIDATION_ERROR" });
  });
  it("accepts only exact HTTPS provider hosts and safe current observations", () => {
    for (const sourceUrl of ["https://www.united.com.attacker.test", "https://account.united.com", "http://www.united.com", "https://user@www.united.com", "https://www.united.com:8443", "https://www.delta.com"]) expect(() => prepareObservation(payload({ sourceUrl }), NOW)).toThrow();
    for (const points of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => prepareObservation(payload({ points }), NOW)).toThrow();
    for (const capturedAt of [new Date("bad"), new Date(NOW.getTime() + 1), new Date(NOW.getTime() - 31 * 86400_000)]) expect(() => prepareObservation(payload({ capturedAt }), NOW)).toThrow();
    const input = payload(); const record = prepareObservation(input, NOW);
    expect(record.sourceHost).toBe("www.united.com");
    expect(JSON.stringify(record)).not.toContain("private");
    expect(prepareObservation({ ...input, points: 101 }, NOW).payloadHash).not.toBe(record.payloadHash);
    expect(prepareObservation({ ...input, sourceUrl: "https://www.united.com/account?private=changed" }, NOW).payloadHash).not.toBe(record.payloadHash);
    expect(prepareObservation({ ...input, sourceMethod: undefined }, NOW).sourceMethod).toBe("manual_entry");
  });
  it("holds tenfold changes in both directions and zero boundaries", () => {
    expect(observationHoldReason(null, 50000)).toBeNull();
    expect(observationHoldReason(100, 999)).toBeNull();
    expect(observationHoldReason(100, 1000)).not.toBeNull();
    expect(observationHoldReason(1000, 100)).not.toBeNull();
    expect(observationHoldReason(100, 0)).not.toBeNull();
    expect(observationHoldReason(0, 100)).not.toBeNull();
    expect(observationHoldReason(0, 0)).toBeNull();
  });
  it("requires canonical owner/provider and active consent before persistence", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = createLoyaltyAccount({ userId: "owner", providerId: "united", membershipNumber: "U1" }); await accounts.insert(account);
    const consents = { findActive: vi.fn().mockResolvedValue(null), grant: vi.fn() } as unknown as ObservationConsentRepository;
    const ingest = vi.fn(); const observations = { ingest } as unknown as AgentObservationRepository;
    const submit = new SubmitAgentObservation(observations, accounts, consents, clock);
    await expect(submit.execute(payload({ accountId: account.id, userId: "other" }))).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    await expect(submit.execute(payload({ accountId: account.id, providerId: "delta", sourceUrl: "https://delta.com" }))).rejects.toMatchObject({ code: "AGENT_VALIDATION_ERROR" });
    await expect(submit.execute(payload({ accountId: account.id }))).rejects.toMatchObject({ code: "OBSERVATION_CONSENT_REQUIRED" });
    expect(ingest).not.toHaveBeenCalled();
    await expect(new GrantObservationConsent(consents, accounts, clock).execute({ userId: "owner", accountId: account.id, expiresAt: new Date(NOW.getTime() + 31 * 86400_000) })).rejects.toMatchObject({ code: "AGENT_VALIDATION_ERROR" });
    expect(consents.grant).not.toHaveBeenCalled();
  });
});
