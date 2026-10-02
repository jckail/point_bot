import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPanel, type TokenRow } from "./agents-panel";

const actions = vi.hoisted(() => ({
  createAccessTokenAction: vi.fn(), grantConsentAction: vi.fn(), revokeAccessTokenAction: vi.fn(),
  resolveReviewAction: vi.fn(), revokeConsentAction: vi.fn(),
}));
vi.mock("@/app/agent-actions", () => actions);
interface CompletedStates { created: unknown; tokenRevoke: unknown; consentRevoke: unknown }
const state = vi.hoisted((): CompletedStates => ({ created: { status: "idle" }, tokenRevoke: { status: "idle" }, consentRevoke: { status: "idle" } }));
// Render real components with completed state; this does not simulate native
// dispatch, focus/select behavior, hydration or delivery of revalidated props.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: (action: unknown, initialState: unknown) => [
    action === actions.createAccessTokenAction ? state.created : action === actions.revokeAccessTokenAction ? state.tokenRevoke : action === actions.revokeConsentAction ? state.consentRevoke : initialState,
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
  state.tokenRevoke = { status: "idle" }; state.consentRevoke = { status: "idle" };
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
  it.each(["token", "consent"] as const)("renders %s revoke failure feedback and retains the unrevoked credential result", kind => {
    const result = { status: "error", message: "Your session expired - sign in again." };
    if (kind === "token") state.tokenRevoke = result; else state.consentRevoke = result;
    const html = render();
    expect(html).toContain('role="alert"'); expect(html).toContain(result.message);
    expect(html).toContain(secret); expect(html).toContain("Copy your token now");
  });
  it.each(["token", "consent"] as const)("renders bounded %s revoke success feedback from its own action state", kind => {
    if (kind === "token") state.tokenRevoke = { status: "success" }; else state.consentRevoke = { status: "success" };
    const html = render();
    expect(html).toContain(kind === "token" ? "Token revoked." : "Consent revoked.");
    expect(html).toContain(secret);
  });
  it("still hides the readonly credential field when the exact created token is revoked", () => {
    const html = render([{ ...token, revokedAt: new Date("2026-10-03T00:00:00Z") }]);
    expect(html).not.toContain(secret); expect(html).not.toContain("Copy your token now");
  });
});
