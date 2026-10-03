import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPanel, type TokenRow } from "./agents-panel";

const actions = vi.hoisted(() => ({
  createAccessTokenAction: vi.fn(), grantConsentAction: vi.fn(), revokeAccessTokenAction: vi.fn(),
  resolveReviewAction: vi.fn(), revokeConsentAction: vi.fn(),
}));
vi.mock("@/app/agent-actions", () => actions);
interface CompletedStates { created: unknown; removal: unknown }
const state = vi.hoisted((): CompletedStates => ({ created: { status: "idle" }, removal: { status: "idle" } }));
// Render real components with completed state; this does not simulate native
// dispatch, focus/select behavior, hydration or delivery of revalidated props.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: (action: unknown, initialState: unknown) => [
    action === actions.createAccessTokenAction ? state.created : action === actions.grantConsentAction ? initialState : state.removal,
    () => {}, false,
  ] };
});
const secret = "pu_SYNTHETIC_READONLY_FIELD";
const token: TokenRow = { id: "synthetic-token", name: "Synthetic agent", displayPrefix: "pu_SYNTH", scopes: ["portfolio:read"], expiresAt: null, lastUsedAt: null, revokedAt: null };
function render(tokens: TokenRow[] = [token]) {
  return renderToStaticMarkup(createElement(AgentsPanel, {
    tokens,
    consents: [{ id: "synthetic-consent", providerId: "united", providerName: "United", expiresAt: new Date("2026-10-04T00:00:00Z"), active: true }],
    observations: [], pendingReviews: [], providers: [], mcpUrl: "http://localhost:8787/mcp",
  }));
}
beforeEach(() => {
  vi.clearAllMocks(); state.created = { status: "created", secret, tokenId: token.id };
  state.removal = { status: "idle" };
});

describe("actual AgentsPanel completed-state rendering", () => {
  it("renders a labeled, enabled readonly text field without a submitted credential name", () => {
    const html = render();
    const field = html.match(/<input\b[^>]*value="pu_SYNTHETIC_READONLY_FIELD"[^>]*>/)?.[0];
    expect(field).toBeDefined(); expect(field).toContain('type="text"'); expect(field).toMatch(/readonly(?:="")?/i);
    expect(field).not.toMatch(/\bdisabled(?:=|\s|>)/); expect(field).not.toMatch(/\bname=/);
    const id = field?.match(/\bid="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    const associatedLabel = html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)`))?.[1];
    expect(associatedLabel?.toLowerCase()).toContain("token");
  });
  it("requires integer lifetime bounds in the actual creation form", () => {
    const field = render().match(/<input\b[^>]*name="ttlDays"[^>]*>/)?.[0];
    expect(field).toBeDefined(); expect(field).toContain('type="number"');
    expect(field).toContain('min="1"'); expect(field).toContain('max="365"'); expect(field).toContain('step="1"');
    expect(field).toMatch(/\brequired(?:="")?/);
  });
  it("renders failed wrapped revoke action feedback in both actual rows and retains the credential", () => {
    state.removal = { status: "error", message: "Your session expired - sign in again." };
    const html = render();
    for (const sectionId of ["agent-tokens", "capture-consent"]) {
      const section = html.match(new RegExp(`<section id="${sectionId}"[\\s\\S]*?</section>`))?.[0];
      expect(section).toContain('role="alert"');
      expect(section).toContain("Your session expired - sign in again.");
    }
    expect(html).toContain(secret); expect(html).toContain("Copy your token now");
  });
  it("keeps empty section-owned status targets mounted without inventing success from row action state", () => {
    state.removal = { status: "success" };
    const html = render();
    for (const sectionId of ["balance-reviews", "capture-consent", "agent-tokens"]) {
      const section = html.match(new RegExp(`<section id="${sectionId}"[\\s\\S]*?</section>`))?.[0];
      expect(section).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*tabindex="-1"[^>]*><\/p>/);
    }
    expect(html).not.toContain("Token revoked."); expect(html).not.toContain("Consent revoked.");
    expect(html).toContain(secret);
  });
  it("does not claim success merely because authoritative rows are absent", () => {
    const html = renderToStaticMarkup(createElement(AgentsPanel, {
      tokens: [], consents: [], observations: [], pendingReviews: [], providers: [], mcpUrl: "http://localhost:8787/mcp",
    }));
    expect(html).toContain("No captured balances are waiting for your review.");
    expect(html).not.toContain("Token revoked."); expect(html).not.toContain("Consent revoked.");
    expect(html).not.toContain("Decision saved.");
  });
  it("still hides the readonly credential field when the exact created token is revoked", () => {
    const html = render([{ ...token, revokedAt: new Date("2026-10-03T00:00:00Z") }]);
    expect(html).not.toContain(secret); expect(html).not.toContain("Copy your token now");
  });
});
