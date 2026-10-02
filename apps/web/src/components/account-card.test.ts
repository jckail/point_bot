import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoyaltyAccountId, PROVIDER_CATALOG, type LoyaltyAccountReadModel } from "@pointup/core";
import { expect, it, vi } from "vitest";
vi.mock("@/app/actions", () => ({ syncLoyaltyAccountAction: async () => undefined, togglePinAccountAction: async () => undefined }));
import { AccountCard } from "./account-card";

const provider = PROVIDER_CATALOG.find(provider => provider.id === "united")!;
const account: LoyaltyAccountReadModel = { id: LoyaltyAccountId.parse("account-1"), provider,
  membershipNumber: "123", hasStoredCredential: false, latestBalance: null, estimatedValueCents: 0,
  customCentsPerPoint: null, trend: { sincePrevious: null, since30Days: null, since90Days: null }, expiresAt: null,
  daysUntilExpiry: null, notes: null, tags: [], pinnedAt: null, createdAt: new Date("2026-10-01T00:00:00Z") };

it("offers manual entry and consented capture instead of a sync form when unavailable", () => {
  const html = renderToStaticMarkup(createElement(AccountCard, { account, syncMode: "unavailable" }));
  expect(html).toContain("Record manually");
  expect(html).toContain("/dashboard/accounts/account-1#record-balance");
  expect(html).toContain("/dashboard/agents#capture-consent");
  expect(html).not.toContain("Sync via API");
  expect(html).not.toContain("Demo sync");
  expect(html.match(/<form\b/g)).toHaveLength(1); // Pinning remains; no sync form.
});
it("clearly labels simulation and preserves the sync form in demo mode", () => {
  const html = renderToStaticMarkup(createElement(AccountCard, { account, syncMode: "demo" }));
  expect(html).toContain("Demo sync");
  expect(html).toContain("Demo balances are simulated");
  expect(html).not.toContain("Sync via API");
  expect(html.match(/<form\b/g)).toHaveLength(2);
});
it("labels configured API sync without claiming live provider access", () => {
  const html = renderToStaticMarkup(createElement(AccountCard, { account, syncMode: "api" }));
  expect(html).toContain("Sync via API");
  expect(html).toContain("provider access and delivery still need verification");
  expect(html).not.toContain("Demo sync");
  expect(html.match(/<form\b/g)).toHaveLength(2);
});
