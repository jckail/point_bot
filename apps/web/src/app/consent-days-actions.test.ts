import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsentGrant, GrantConsent, UserId } from "@pointup/core";
import { InMemoryConsents, RecordingEventing } from "../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { grantConsent: { execute: state.grant } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
// Static form markup only. No native hook dispatch or browser behavior proof.
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: (_action: unknown, initialState: unknown) => [initialState, () => {}, false],
}));
import { grantConsentAction } from "./agent-actions";
import { AgentsPanel } from "@/components/agents-panel";

const owner = UserId.parse("synthetic-consent-owner");
const foreign = UserId.parse("other-consent-owner");
const now = new Date("2026-10-03T00:00:00Z");
const clock = { now: () => now };
const message = "Consent can last between 1 and 90 days.";
function form(days: string | undefined) {
  const data = new FormData(); data.set("providerId", "united"); if (days !== undefined) data.set("days", days); return data;
}
function fixture() {
  const consents = new InMemoryConsents(); const eventing = new RecordingEventing();
  const previous = createConsentGrant({ userId: owner, providerId: "united", days: 90, now });
  const other = createConsentGrant({ userId: foreign, providerId: "united", days: 90, now });
  consents.rows.set(previous.id, previous); consents.rows.set(other.id, other);
  const useCase = new GrantConsent(consents, clock, eventing);
  state.grant.mockImplementation(input => useCase.execute(input));
  return { consents, eventing, previous, other, useCase, replace: vi.spyOn(consents, "replaceActive") };
}
function expectUnchanged(f: ReturnType<typeof fixture>) {
  expect(f.replace).not.toHaveBeenCalled(); expect([...f.consents.rows.values()]).toEqual([f.previous, f.other]);
  expect(f.eventing.events).toEqual([]); expect(state.revalidate).not.toHaveBeenCalled();
}
beforeEach(() => { vi.resetAllMocks(); state.session.mockResolvedValue(owner); });

describe("web consent requires an explicit bounded duration", () => {
  it.each(["", "   ", "0", "-1", "NaN", "Infinity", "91", "1.5", undefined])("rejects days=%s without replacing an existing grant or emitting effects", async days => {
    const f = fixture();
    expect(await grantConsentAction({ status: "idle" }, form(days))).toEqual({ status: "error", message });
    expectUnchanged(f);
  });
  it("rejects a file-valued duration without silently granting 30 days", async () => {
    const f = fixture(); const data = form("1"); data.set("days", new Blob(["synthetic-upload"]), "synthetic.txt");
    expect(await grantConsentAction({ status: "idle" }, data)).toEqual({ status: "error", message });
    expectUnchanged(f);
  });
  it.each([1, 90])("grants the actual %s-day boundary for the session owner and preserves the other owner", async days => {
    const f = fixture(); const data = form(String(days)); data.set("userId", foreign);
    expect(await grantConsentAction({ status: "idle" }, data)).toEqual({ status: "success" });
    expect(state.grant).toHaveBeenCalledWith({ userId: owner, providerId: "united", days });
    expect(f.consents.rows.get(f.previous.id)?.revokedAt).toEqual(now);
    expect(f.consents.rows.get(f.other.id)).toEqual(f.other);
    const created = [...f.consents.rows.values()].find(row => row.id !== f.previous.id && row.id !== f.other.id);
    expect(created).toMatchObject({ userId: owner, providerId: "united", grantedAt: now, expiresAt: new Date(now.getTime() + days * 86400000), revokedAt: null });
    expect(f.replace).toHaveBeenCalledOnce(); expect(f.eventing.types()).toEqual(["consent.granted"]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard/agents");
  });
  it("preserves the core optional-duration default for non-web callers", async () => {
    const f = fixture(); const result = await f.useCase.execute({ userId: owner, providerId: "united" });
    expect(result.expiresAt).toEqual(new Date(now.getTime() + 30 * 86400000));
    expect(result.active).toBe(true); expect(f.consents.rows.get(f.other.id)).toEqual(f.other);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("returns expired-session feedback without reading or changing grants", async () => {
    const f = fixture(); state.session.mockResolvedValueOnce(null);
    expect(await grantConsentAction({ status: "idle" }, form("1"))).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(state.grant).not.toHaveBeenCalled(); expectUnchanged(f);
  });
  it("retains actual core provider validation and bounded error feedback", async () => {
    const f = fixture(); const data = form("1"); data.set("providerId", "synthetic-unsupported-provider");
    expect(await grantConsentAction({ status: "idle" }, data)).toEqual({ status: "error", message: "That program isn't supported yet." });
    expectUnchanged(f);
  });
  it("propagates infrastructure failure without success, grant replacement, events or refresh", async () => {
    const f = fixture(); const error = new Error("SYNTHETIC_PRIVATE_CONSENT_REPOSITORY_DIAGNOSTIC");
    f.replace.mockRejectedValueOnce(error);
    await expect(grantConsentAction({ status: "idle" }, form("1"))).rejects.toBe(error);
    expect([...f.consents.rows.values()]).toEqual([f.previous, f.other]);
    expect(f.eventing.events).toEqual([]); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("renders an explicit required whole-day field with the advertised bounds", () => {
    const html = renderToStaticMarkup(createElement(AgentsPanel, { tokens: [], consents: [], observations: [], pendingReviews: [], providers: [{ id: "united", name: "United" }], mcpUrl: "http://localhost:8787/mcp" }));
    const input = html.match(/<input\b[^>]*name="days"[^>]*>/)?.[0];
    expect(input).toBeDefined(); expect(input).toContain('type="number"');
    expect(input).toContain('min="1"'); expect(input).toContain('max="90"'); expect(input).toContain('step="1"');
    expect(input).toMatch(/\brequired(?:="")?/);
  });
});
