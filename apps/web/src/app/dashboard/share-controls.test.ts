import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoyaltyAccount, createPortfolioShare, ListLoyaltyAccounts,
  ListPortfolioShares, softDeleteLoyaltyAccount, UserId,
  type PortfolioShareReadModel,
} from "@pointup/core";
import {
  InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository,
  InMemoryPortfolioShareRepository,
} from "../../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({ session: vi.fn(), accounts: vi.fn(), shares: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session, getSessionUser: async () => null }));
vi.mock("@/server/provider-sync", () => ({ getProviderSyncOptions: () => ({ modes: {}, bulkLabel: null }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "pointup.test", "x-forwarded-proto": "https" }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: {
  listLoyaltyAccounts: { execute: state.accounts }, listPortfolioShares: { execute: state.shares },
  listActivity: { execute: async () => [] }, listExpiringAccounts: { execute: async () => [] },
  listTripGoals: { execute: async () => [] }, listDeletedLoyaltyAccounts: { execute: async () => [] },
  getValueAdvice: { execute: async () => ({ transfers: [], deals: [], eligibilityWarnings: [] }) },
  listBestRedemptions: { execute: async () => ({}) }, listProviders: { execute: async () => [] },
} }) }));
import DashboardPage from "./page";
import { SharePortfolioSection } from "@/components/share-portfolio-section";

// Inspect the real async server controller's React tree. No fake DOM, hook
// replacement or mirrored eligibility helper is used; interactive UI is untested.
function findShareControls(node: ReactNode): ReactElement<{ shares: PortfolioShareReadModel[]; baseUrl: string }> | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === SharePortfolioSection) return node as ReactElement<{ shares: PortfolioShareReadModel[]; baseUrl: string }>;
  for (const child of Children.toArray(node.props.children)) {
    const result = findShareControls(child);
    if (result) return result;
  }
  return undefined;
}
const owner = UserId.parse("synthetic-empty-portfolio-owner");
const now = new Date("2026-10-02T12:00:00Z");
beforeEach(() => { vi.resetAllMocks(); state.session.mockResolvedValue(owner); });

function fixture() {
  const accountRows = new InMemoryLoyaltyAccountRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "united", membershipNumber: "synthetic", now });
  // Models unlinking the last account: its tombstone remains, active list is empty.
  accountRows.rows.set(account.id, softDeleteLoyaltyAccount(account, now));
  const accountList = new ListLoyaltyAccounts(accountRows, new InMemoryBalanceSnapshotRepository(), { now: () => now });
  const shares = new InMemoryPortfolioShareRepository();
  const shareList = new ListPortfolioShares(shares, { now: () => now });
  state.accounts.mockImplementation(userId => accountList.execute(userId));
  state.shares.mockImplementation(userId => shareList.execute(userId));
  return { accountRows, shares };
}

describe("dashboard share management with no active programs", () => {
  it("preserves management of an active link after the last account is unlinked", async () => {
    const f = fixture();
    const share = createPortfolioShare({ userId: owner, token: "synthetic-active-token", label: "Friends", now });
    f.shares.rows.set(share.id, share);
    const controls = findShareControls(await DashboardPage());
    expect(controls).toBeDefined();
    expect(controls?.props.shares).toContainEqual(expect.objectContaining({ id: share.id, token: share.token, active: true }));
    expect(controls?.props.baseUrl).toBe("https://pointup.test");
    expect(state.accounts).toHaveBeenCalledWith(owner); expect(state.shares).toHaveBeenCalledWith(owner);
    expect(f.shares.rows.get(share.id)).toEqual(share); // Rendering does not revoke or mutate.
  });
  it.each(["none", "revoked", "expired", "foreign"] as const)("keeps empty management hidden with only %s links", async kind => {
    const f = fixture();
    if (kind !== "none") {
      const share = createPortfolioShare({ userId: kind === "foreign" ? UserId.parse("other-owner") : owner,
        token: "synthetic-inactive-token", now,
        expiresAt: kind === "expired" ? now : null });
      f.shares.rows.set(share.id, kind === "revoked" ? { ...share, revokedAt: now } : share);
    }
    expect(findShareControls(await DashboardPage())).toBeUndefined();
  });
});
