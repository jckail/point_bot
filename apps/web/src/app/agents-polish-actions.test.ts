import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccessToken, createConsentGrant, IssueAccessToken,
  RevokeAccessToken, RevokeConsent, UserId,
} from "@pointup/core";
import { InMemoryConsents, InMemoryTokens, RecordingEventing } from "../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({ session: vi.fn(), issue: vi.fn(), revokeToken: vi.fn(), revokeConsent: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: {
  issueAccessToken: { execute: state.issue }, revokeAccessToken: { execute: state.revokeToken },
  revokeConsent: { execute: state.revokeConsent },
} }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
import { createAccessTokenAction, revokeAccessTokenAction, revokeConsentAction } from "./agent-actions";

const owner = UserId.parse("synthetic-agents-owner");
const now = new Date("2026-10-03T00:00:00Z");
const clock = { now: () => now };
const tokenRequestMessage = "Give the token a name, at least one scope, and a lifetime of 1-365 days.";
function createForm(ttl: string | undefined) {
  const data = new FormData(); data.set("name", "Synthetic agent"); data.append("scopes", "portfolio:read");
  if (ttl !== undefined) data.set("ttlDays", ttl);
  return data;
}
function createFixture() {
  const tokens = new InMemoryTokens(); const eventing = new RecordingEventing();
  const useCase = new IssueAccessToken(tokens, clock, eventing);
  state.issue.mockImplementation(input => useCase.execute(input));
  return { tokens, eventing, insert: vi.spyOn(tokens, "insert") };
}
beforeEach(() => { vi.resetAllMocks(); state.session.mockResolvedValue(owner); });

describe("bounded web token lifetime with actual IssueAccessToken", () => {
  it.each(["", "   ", "0", "-1", "NaN", "Infinity", "366", "1.5", undefined])("rejects TTL %s without minting an unintended non-expiring token", async ttl => {
    const f = createFixture();
    expect(await createAccessTokenAction({ status: "idle" }, createForm(ttl))).toEqual({ status: "error", message: tokenRequestMessage });
    expect(f.insert).not.toHaveBeenCalled(); expect(f.tokens.rows.size).toBe(0);
    expect(f.eventing.events).toEqual([]); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("rejects a file-valued TTL without minting a non-expiring token", async () => {
    const f = createFixture(); const data = createForm("1");
    data.set("ttlDays", new Blob(["synthetic-upload"]), "synthetic.txt");
    expect(await createAccessTokenAction({ status: "idle" }, data)).toEqual({ status: "error", message: tokenRequestMessage });
    expect(f.insert).not.toHaveBeenCalled(); expect(f.tokens.rows.size).toBe(0);
    expect(f.eventing.events).toEqual([]); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it.each([1, 365])("persists the valid %s-day boundary with matching actual expiry", async days => {
    const f = createFixture();
    const result = await createAccessTokenAction({ status: "idle" }, createForm(String(days)));
    expect(result.status).toBe("created");
    expect(f.tokens.rows.size).toBe(1);
    const token = [...f.tokens.rows.values()][0];
    expect(token?.userId).toBe(owner); expect(token?.expiresAt).toEqual(new Date(now.getTime() + days * 86400000));
    expect(f.insert).toHaveBeenCalledOnce(); expect(f.eventing.types()).toEqual(["token.issued"]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard/agents");
  });
});

async function revokeFixture(expired = false) {
  const tokens = new InMemoryTokens(); const consents = new InMemoryConsents(); const eventing = new RecordingEventing();
  const createdAt = expired ? new Date(now.getTime() - 2 * 86400000) : now;
  const { token } = await createAccessToken({ userId: owner, name: "Synthetic agent", scopes: ["portfolio:read"], ttlDays: 1, now: createdAt });
  const consent = createConsentGrant({ userId: owner, providerId: "united", days: 1, now: createdAt });
  tokens.rows.set(token.id, token); consents.rows.set(consent.id, consent);
  const tokenUseCase = new RevokeAccessToken(tokens, clock, eventing);
  const consentUseCase = new RevokeConsent(consents, clock, eventing);
  state.revokeToken.mockImplementation((userId, id) => tokenUseCase.execute(userId, id));
  state.revokeConsent.mockImplementation((userId, id) => consentUseCase.execute(userId, id));
  return { tokens, consents, eventing, token, consent, tokenUpdate: vi.spyOn(tokens, "update"), consentUpdate: vi.spyOn(consents, "update") };
}
type Kind = "token" | "consent";
function revokeForm(kind: Kind, f: Awaited<ReturnType<typeof revokeFixture>>) {
  const data = new FormData(); data.set(kind === "token" ? "tokenId" : "consentId", kind === "token" ? f.token.id : f.consent.id); return data;
}
function runRevoke(kind: Kind, data: FormData) {
  return kind === "token" ? revokeAccessTokenAction({ status: "idle" }, data) : revokeConsentAction({ status: "idle" }, data);
}
function expectNoRevokeEffects(f: Awaited<ReturnType<typeof revokeFixture>>) {
  expect(f.tokenUpdate).not.toHaveBeenCalled(); expect(f.consentUpdate).not.toHaveBeenCalled();
  expect(f.eventing.events).toEqual([]); expect(state.revalidate).not.toHaveBeenCalled();
}

describe.each(["token", "consent"] as const)("%s revoke feedback with actual core ownership", kind => {
  it("returns expired-session feedback without invoking either mutation", async () => {
    const f = await revokeFixture(); state.session.mockResolvedValueOnce(null);
    expect(await runRevoke(kind, revokeForm(kind, f))).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(state.revokeToken).not.toHaveBeenCalled(); expect(state.revokeConsent).not.toHaveBeenCalled(); expectNoRevokeEffects(f);
    expect(f.tokens.rows.get(f.token.id)).toEqual(f.token); expect(f.consents.rows.get(f.consent.id)).toEqual(f.consent);
  });
  it.each(["missing", "foreign"] as const)("maps %s ownership failure privately without writes, events or refresh", async failure => {
    const f = await revokeFixture();
    if (failure === "foreign") state.session.mockResolvedValueOnce(UserId.parse("other-owner"));
    else if (kind === "token") f.tokens.rows.delete(f.token.id);
    else f.consents.rows.delete(f.consent.id);
    expect(await runRevoke(kind, revokeForm(kind, f))).toEqual({ status: "error", message: kind === "token" ? "We couldn't find that token." : "We couldn't find that consent." });
    expectNoRevokeEffects(f);
    if (failure === "foreign") {
      expect(f.tokens.rows.get(f.token.id)).toEqual(f.token); expect(f.consents.rows.get(f.consent.id)).toEqual(f.consent);
    }
  });
  it("maps an absent ID without invoking either mutation", async () => {
    const f = await revokeFixture();
    expect(await runRevoke(kind, new FormData())).toEqual({ status: "error", message: "Something went wrong. Please try again." });
    expect(state.revokeToken).not.toHaveBeenCalled(); expect(state.revokeConsent).not.toHaveBeenCalled(); expectNoRevokeEffects(f);
  });
  it.each([false, true])("revokes an owned row with expired=%s and refreshes only after actual success", async expired => {
    const f = await revokeFixture(expired);
    expect(await runRevoke(kind, revokeForm(kind, f))).toEqual({ status: "success" });
    if (kind === "token") {
      expect(state.revokeToken).toHaveBeenCalledWith(owner, f.token.id);
      expect(f.tokens.rows.get(f.token.id)?.revokedAt).toEqual(now);
      expect(f.tokenUpdate).toHaveBeenCalledOnce(); expect(f.consentUpdate).not.toHaveBeenCalled();
    } else {
      expect(state.revokeConsent).toHaveBeenCalledWith(owner, f.consent.id);
      expect(f.consents.rows.get(f.consent.id)?.revokedAt).toEqual(now);
      expect(f.consentUpdate).toHaveBeenCalledOnce(); expect(f.tokenUpdate).not.toHaveBeenCalled();
    }
    expect(f.eventing.types()).toEqual([kind === "token" ? "token.revoked" : "consent.revoked"]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard/agents");
  });
  it("preserves the core already-revoked no-op without emitting a second event", async () => {
    const f = await revokeFixture();
    expect(await runRevoke(kind, revokeForm(kind, f))).toEqual({ status: "success" });
    expect(await runRevoke(kind, revokeForm(kind, f))).toEqual({ status: "success" });
    expect(f.tokenUpdate.mock.calls.length + f.consentUpdate.mock.calls.length).toBe(1);
    expect(f.eventing.types()).toEqual([kind === "token" ? "token.revoked" : "consent.revoked"]);
    expect(state.revalidate.mock.calls).toEqual([["/dashboard/agents"], ["/dashboard/agents"]]);
  });
  it("propagates repository failure without leaking it as public feedback or claiming success", async () => {
    const f = await revokeFixture(); const error = new Error("SYNTHETIC_PRIVATE_REPOSITORY_DIAGNOSTIC");
    if (kind === "token") vi.spyOn(f.tokens, "findById").mockRejectedValueOnce(error);
    else vi.spyOn(f.consents, "findById").mockRejectedValueOnce(error);
    await expect(runRevoke(kind, revokeForm(kind, f))).rejects.toBe(error);
    expectNoRevokeEffects(f);
    expect(f.tokens.rows.get(f.token.id)).toEqual(f.token); expect(f.consents.rows.get(f.consent.id)).toEqual(f.consent);
  });
});
