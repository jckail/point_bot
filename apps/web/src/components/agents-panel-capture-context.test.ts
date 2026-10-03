import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GrantConsent, LinkLoyaltyAccount, ListAgentObservations, RecordManualBalance,
  ResolveObservationReview, SubmitObservation, UserId,
} from "@pointup/core";
import {
  AtomicObservationEventing, InMemoryActivityEventRepository, InMemoryBalanceSnapshotRepository,
  InMemoryConsents, InMemoryLoyaltyAccountRepository, InMemoryObservations, InMemoryTokens,
} from "../../../../packages/core/test/fakes";
import { AgentsPanel } from "./agents-panel";

const boundary = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: boundary.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: {
  listAccessTokens: { execute: async () => [] }, listConsents: { execute: async () => [] },
  listAgentObservations: { execute: boundary.list },
} }) }));
vi.mock("@/app/agent-actions", () => ({
  createAccessTokenAction: vi.fn(), grantConsentAction: vi.fn(), revokeAccessTokenAction: vi.fn(),
  resolveReviewAction: vi.fn(), revokeConsentAction: vi.fn(),
}));
vi.mock("@/components/reviewed-assistant-actions", () => ({ ReviewedAssistantActions: () => null }));
import AgentsPage from "@/app/dashboard/agents/page";

const owner = UserId.parse("synthetic-capture-context-owner");
const now = new Date("2026-10-03T12:00:00.000Z");
const historical = new Date("2026-10-02T11:59:58.000Z");
const clock = { now: () => new Date(now.getTime()) };

async function fixture() {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const consents = new InMemoryConsents(); const tokens = new InMemoryTokens();
  const observations = new InMemoryObservations({ accounts, consents, tokens });
  const eventing = new AtomicObservationEventing({ accounts, balances, activity, observations, consents, tokens });
  const record = new RecordManualBalance(accounts, balances, activity, clock, eventing);
  const link = new LinkLoyaltyAccount(accounts, activity, clock, eventing);
  const submit = new SubmitObservation(accounts, balances, consents, observations, record, link, clock, eventing);
  const review = new ResolveObservationReview(accounts, balances, observations, record, clock, eventing);
  await link.execute({ userId: owner, providerId: "united", membershipNumber: "MEMBER_PRIVATE_SENTINEL" });
  await new GrantConsent(consents, clock, eventing).execute({ userId: owner, providerId: "united" });
  const input = {
    userId: owner, skillId: "united.capture-balance", agent: "Synthetic capture",
    sourceUrl: "https://www.united.com/account?private=QUERY_PRIVATE_SENTINEL",
    credential: { kind: "session" as const }, sourceMethod: "page_capture" as const,
  };
  await submit.execute({ ...input, points: 50_000 });
  const old = await submit.execute({ ...input, points: 5, observedAt: historical, captureId: "ad75b9af-3c7c-4c33-8ab1-36168e822201" });
  const current = await submit.execute({ ...input, points: 5, observedAt: now, captureId: "ad75b9af-3c7c-4c33-8ab1-36168e822202" });
  expect(old.outcome).toBe("needs_review"); expect(current.outcome).toBe("needs_review");
  boundary.list.mockImplementation(userId => new ListAgentObservations(observations).execute(userId, 100));
  return { observations, balances, review, old, current };
}

function findPanel(node: ReactNode): ReactElement<Parameters<typeof AgentsPanel>[0]> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === AgentsPanel) return child as ReactElement<Parameters<typeof AgentsPanel>[0]>;
    const found = findPanel(child.props.children);
    if (found) return found;
  }
  return undefined;
}
function section(html: string, id: string): string {
  const result = html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`))?.[0];
  if (!result) throw new Error(`Missing synthetic test section ${id}`);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); boundary.session.mockResolvedValue(owner);
});
afterEach(() => vi.useRealTimers());

describe("real held captures through actual AgentsPage and AgentsPanel", () => {
  it("preserves distinct capture times and equal submission times in both public row projections", async () => {
    const f = await fixture(); const tree = await AgentsPage(); const panel = findPanel(tree);
    expect(panel).toBeDefined();
    const reviews = panel!.props.pendingReviews;
    expect(reviews).toHaveLength(2);
    expect(reviews.map(row => row.observedAt.toISOString()).sort()).toEqual([historical.toISOString(), now.toISOString()].sort());
    expect(reviews.every(row => row.createdAt.getTime() === now.getTime())).toBe(true);
    for (const row of reviews) {
      expect(row.points).toBe(5); expect(row.previousPoints).toBe(50_000);
      const history = panel!.props.observations.find(value => value.id === row.id);
      expect(history?.observedAt).toEqual(row.observedAt); expect(history?.createdAt).toEqual(row.createdAt);
    }
    const html = renderToStaticMarkup(tree);
    for (const id of ["balance-reviews", "capture-history"]) {
      const rendered = section(html, id);
      expect(rendered.toLowerCase()).toContain(`captured: <time datetime="${historical.toISOString().toLowerCase()}"`);
      expect(rendered.toLowerCase()).toContain(`captured: <time datetime="${now.toISOString().toLowerCase()}"`);
      expect(rendered.toLowerCase()).toContain(`submitted: <time datetime="${now.toISOString().toLowerCase()}"`);
      expect(rendered).toContain("UTC");
    }
    expect(f.observations.rows.filter(row => row.outcome === "needs_review")).toHaveLength(2);
  });

  it("associates every actual Confirm/Reject control with its own summary and capture time", async () => {
    await fixture(); const html = renderToStaticMarkup(await AgentsPage());
    const rows = section(html, "balance-reviews").match(/<li\b[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    const allIds = new Set<string>();
    for (const row of rows) {
      const buttons = row.match(/<button\b[^>]*aria-labelledby="[^"]+"[^>]*>[\s\S]*?<\/button>/g) ?? [];
      expect(buttons).toHaveLength(2);
      const ids = [...row.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]!);
      for (const id of ids) { expect(allIds.has(id)).toBe(false); allIds.add(id); }
      for (const button of buttons) {
        const references = button.match(/aria-labelledby="([^"]+)"/)![1]!.split(" ");
        expect(references).toHaveLength(3);
        for (const id of references) expect(ids).toContain(id);
        const summary = row.match(new RegExp(`<p id="${references[1]}"[^>]*>([\\s\\S]*?)</p>`))![1]!;
        const capture = row.match(new RegExp(`<p id="${references[2]}"[^>]*>([\\s\\S]*?)</p>`))![1]!;
        expect(summary).toContain("United"); expect(summary).toContain("<strong>5</strong>");
        expect(capture).toContain("Captured:"); expect(capture).toContain("UTC");
        expect(button).toMatch(/value="(?:confirm|reject)"/);
        expect(button).toMatch(/(?:Confirm|Reject) balance/);
      }
    }
  });

  it("does not project private real receipt witnesses, hashes, identities or source queries", async () => {
    const f = await fixture(); const tree = await AgentsPage(); const panel = findPanel(tree)!;
    const serialized = JSON.stringify(panel.props); const html = renderToStaticMarkup(tree);
    for (const marker of ["MEMBER_PRIVATE_SENTINEL", "QUERY_PRIVATE_SENTINEL"]) {
      expect(serialized).not.toContain(marker); expect(html).not.toContain(marker);
    }
    const held = f.observations.rows.filter(row => row.outcome === "needs_review");
    for (const row of held) {
      expect(row.payloadHash).toBeTruthy(); expect(row.accountIdentityWitness).toBeTruthy();
      for (const privateValue of [row.payloadHash, row.captureId, row.accountIdentityWitness?.nonce, row.accountIdentityWitness?.digest]) {
        expect(privateValue).toBeTruthy(); expect(serialized).not.toContain(privateValue!); expect(html).not.toContain(privateValue!);
      }
    }
    for (const rows of [panel.props.pendingReviews, panel.props.observations]) {
      for (const row of rows) {
        for (const privateKey of ["userId", "credentialKind", "accessTokenId", "accountIdentityWitness", "payloadHash", "captureId"]) expect(row).not.toHaveProperty(privateKey);
      }
    }
  });

  it("renders the time the real historical confirmation writes without replacing the latest balance", async () => {
    const f = await fixture();
    expect(f.old.reviewId).toBeTruthy();
    await f.review.confirm(owner, f.old.reviewId!);
    const inserted = f.balances.rows.at(-1)!;
    expect(inserted.points).toBe(5); expect(inserted.capturedAt).toEqual(historical);
    const latest = (await f.balances.findLatestByAccountIds([f.old.accountId])).get(f.old.accountId);
    expect(latest?.points).toBe(50_000); expect(latest?.id).not.toBe(inserted.id);
    const tree = await AgentsPage(); const panel = findPanel(tree)!;
    expect(panel.props.pendingReviews.map(row => row.id)).toEqual([f.current.reviewId]);
    expect(panel.props.observations.find(row => row.id === f.old.reviewId)?.outcome).toBe("recorded");
    expect(section(renderToStaticMarkup(tree), "capture-history").toLowerCase()).toContain(`captured: <time datetime="${historical.toISOString().toLowerCase()}"`);
  });
});
