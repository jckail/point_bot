import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, IssueAccessToken, ListAccessTokens, RevokeAccessToken, UserId } from "@pointup/core";
import { InMemoryTokens, RecordingEventing } from "../../../../packages/core/test/fakes";

const state = vi.hoisted<{
  session: ReturnType<typeof vi.fn>; issue: ReturnType<typeof vi.fn<IssueAccessToken["execute"]>>;
  revalidate: ReturnType<typeof vi.fn>; created: unknown; createAction: unknown;
}>(() => ({
  session: vi.fn(), issue: vi.fn<IssueAccessToken["execute"]>(), revalidate: vi.fn(),
  created: { status: "idle" }, createAction: undefined,
}));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { issueAccessToken: { execute: state.issue } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
// Supply a completed action state to the actual component. React renders its
// real subtree; this seam does not emulate dispatch, hydration or revalidation.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: (action: unknown, initialState: unknown) => [action === state.createAction ? state.created : initialState, () => {}, false] };
});
import { createAccessTokenAction } from "@/app/agent-actions";
import { AgentsPanel, type TokenRow } from "./agents-panel";

const owner = UserId.parse("synthetic-token-display-owner");
const clock = { now: () => new Date("2026-10-03T00:00:00Z") };
function form(name = "Synthetic agent") {
  const data = new FormData(); data.set("name", name); data.append("scopes", "portfolio:read"); data.set("ttlDays", "30"); return data;
}
function fixture() {
  const tokens = new InMemoryTokens(); const eventing = new RecordingEventing();
  const issue = new IssueAccessToken(tokens, clock, eventing);
  const list = new ListAccessTokens(tokens); const revoke = new RevokeAccessToken(tokens, clock, eventing);
  state.issue.mockImplementation(input => issue.execute(input));
  return { tokens, eventing, list, revoke };
}
async function create(f: ReturnType<typeof fixture>, name = "Synthetic agent") {
  const result = await createAccessTokenAction({ status: "idle" }, form(name));
  if (result.status !== "created") throw new Error("Synthetic token creation failed");
  const rows = await f.list.execute(owner);
  const token = rows.find(row => row.name === name);
  if (!token) throw new Error("Synthetic created token missing");
  return { result, token };
}
async function rows(f: ReturnType<typeof fixture>): Promise<TokenRow[]> {
  return (await f.list.execute(owner)).map(row => ({ ...row, scopes: [...row.scopes] }));
}
function render(tokens: TokenRow[]) {
  return renderToStaticMarkup(createElement(AgentsPanel, {
    tokens, consents: [], observations: [], pendingReviews: [], providers: [], mcpUrl: "http://localhost:8787/mcp",
  }));
}
beforeEach(() => {
  vi.resetAllMocks(); state.session.mockResolvedValue(owner);
  state.createAction = createAccessTokenAction; state.created = { status: "idle" };
});

describe("actual token creation result and rendered one-time credential", () => {
  it("returns the actual issued token ID alongside its matching plaintext, without private stored fields", async () => {
    const f = fixture(); const { result, token } = await create(f);
    expect(result).toEqual({ status: "created", secret: result.secret, tokenId: token.id });
    const stored = f.tokens.rows.get(token.id);
    expect(stored?.userId).toBe(owner); expect(stored?.tokenHash).toBe(await hashToken(result.secret));
    expect(Object.keys(result).sort()).toEqual(["secret", "status", "tokenId"]);
    expect(f.eventing.types()).toEqual(["token.issued"]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard/agents");
  });

  it("removes the created plaintext and copy guidance when the same token is authoritatively revoked", async () => {
    const f = fixture(); const { result, token } = await create(f); state.created = result;
    expect(render(await rows(f))).toContain(result.secret);
    await f.revoke.execute(owner, token.id);
    const authoritative = await rows(f);
    expect(authoritative.find(row => row.id === token.id)?.revokedAt).toEqual(clock.now());
    const html = render(authoritative);
    expect(html).not.toContain(result.secret); expect(html).not.toContain("Copy your token now");
    expect(html).toContain("No active tokens.");
  });

  it("preserves the created credential when another token is revoked", async () => {
    const f = fixture(); const first = await create(f); const other = await create(f, "Other synthetic agent");
    const otherStored = f.tokens.rows.get(other.token.id);
    if (!otherStored) throw new Error("Synthetic other token missing");
    // Labels/prefixes can collide; only the immutable actual ID may hide state.
    await f.tokens.update({ ...otherStored, name: first.token.name, displayPrefix: first.token.displayPrefix });
    state.created = first.result; await f.revoke.execute(owner, other.token.id);
    const authoritative = await rows(f);
    expect(authoritative.find(row => row.id === other.token.id)).toMatchObject({ name: first.token.name, displayPrefix: first.token.displayPrefix, revokedAt: clock.now() });
    const html = render(authoritative);
    expect(html).toContain(first.result.secret); expect(html).toContain("Copy your token now");
    expect(html).not.toContain(other.result.secret);
  });

  it("preserves the created credential when the same token is still unrevoked", async () => {
    const f = fixture(); const { result, token } = await create(f); state.created = result;
    expect(token.revokedAt).toBeNull();
    const html = render(await rows(f));
    expect(html).toContain(result.secret); expect(html).toContain("Copy your token now");
  });

  it("preserves the creation result when the authoritative token list has not yet included that ID", async () => {
    const f = fixture(); const { result } = await create(f); state.created = result;
    const html = render([]);
    expect(html).toContain(result.secret); expect(html).toContain("Copy your token now");
  });

  it("renders actual failed creation feedback instead of a stale plaintext block", async () => {
    const f = fixture(); const { result } = await create(f); state.created = result;
    expect(render(await rows(f))).toContain(result.secret);
    state.revalidate.mockClear();
    const failed = await createAccessTokenAction(result, form("")); state.created = failed;
    expect(failed).toEqual({ status: "error", message: "Give the token a name, at least one scope, and a lifetime of 1-365 days." });
    const html = render(await rows(f));
    expect(html).toContain('role="alert"'); expect(html).toContain("Give the token a name");
    expect(html).not.toContain(result.secret); expect(html).not.toContain("Copy your token now");
    expect(f.tokens.rows.size).toBe(1); expect(f.eventing.types()).toEqual(["token.issued"]);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
