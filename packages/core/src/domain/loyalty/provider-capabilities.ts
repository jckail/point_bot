/** Public program guidance; primary sources and verification limits are in docs/provider-capabilities.md. */
export interface ProviderCapabilities {
  readonly officialAccountUrl: string;
  readonly collectionMethods: readonly ("manual" | "page_capture")[];
  /** Generic visible-page capture needs the member to verify the proposed amount. */
  readonly pageCapture: "review_required" | "unavailable";
  /** Catalog knowledge, never a claim about deployment credentials or live access. */
  readonly automaticSync: "requires_verified_adapter";
  readonly balanceApiReadiness: "not_verified" | "partnership_required";
  readonly balanceUnit: "points_or_miles" | "ambiguous";
  readonly balanceGuidance: string;
}

const CAPABILITIES: Readonly<Record<string, ProviderCapabilities>> = {
  "united": {
    officialAccountUrl: "https://www.united.com/en-US/us/account/", collectionMethods: ["manual", "page_capture"],
    pageCapture: "review_required", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Use redeemable miles, not status qualification.",
  },
  "delta": {
    officialAccountUrl: "https://www.delta.com/us/en/need-help/support-skymiles", collectionMethods: ["manual", "page_capture"],
    pageCapture: "review_required", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Use redeemable miles, not qualification or status amounts.",
  },
  "american": {
    officialAccountUrl: "https://www.aa.com/pubcontent/en_US/aadvantage-program/answers-support/aadvantage-support.html", collectionMethods: ["manual", "page_capture"],
    pageCapture: "review_required", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Use AAdvantage miles, not Loyalty Points.",
  },
  "marriott": {
    officialAccountUrl: "https://www.marriott.com/loyalty.mi", collectionMethods: ["manual", "page_capture"],
    pageCapture: "review_required", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Sign in and verify your available points; signed-out templates may show zero.",
  },
  "hilton": {
    officialAccountUrl: "https://www.hilton.com/en/hilton-honors/", collectionMethods: ["manual", "page_capture"],
    pageCapture: "review_required", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "partnership_required", balanceUnit: "points_or_miles",
    balanceGuidance: "Use redeemable Honors points.",
  },
  "hyatt": {
    officialAccountUrl: "https://world.hyatt.com/content/gp/en/sign-in.html", collectionMethods: ["manual", "page_capture"],
    pageCapture: "review_required", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Complete sign-in yourself, then review the account balance.",
  },
  "chase-ultimate-rewards": {
    officialAccountUrl: "https://www.chase.com/personal/credit-cards/rewards-details", collectionMethods: ["manual"],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "partnership_required", balanceUnit: "points_or_miles",
    balanceGuidance: "Manual entry: select the correct card/account and available points, excluding pending rewards.",
  },
  "amex-membership-rewards": {
    officialAccountUrl: "https://www.americanexpress.com/us/customer-service/faq.how-to-see-mr-points-for-my-card.html", collectionMethods: ["manual"],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Manual entry from Point Summary: confirm the Rewards account and exclude pending points.",
  },
  "capital-one-miles": {
    officialAccountUrl: "https://www.capitalone.com/credit-cards/rewards/", collectionMethods: ["manual"],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "partnership_required", balanceUnit: "points_or_miles",
    balanceGuidance: "Manual entry: use miles for the selected card, not dollar-denominated rewards.",
  },
  "citi-thankyou": {
    officialAccountUrl: "https://www.thankyou.com/", collectionMethods: ["manual"],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Manual entry from My Account \u2192 My Point Summary; exclude pending points.",
  },
  "bilt": {
    officialAccountUrl: "https://www.bilt.com/", collectionMethods: ["manual"],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Manual entry: Bilt Points only. Bilt Cash is a separate USD balance.",
  },
  "amtrak": {
    officialAccountUrl: "https://www.amtrak.com/guestrewards/account-overview.html", collectionMethods: ["manual"],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "points_or_miles",
    balanceGuidance: "Manual entry: Available Points only, not Tier Qualifying Points.",
  },
  "rakuten": {
    officialAccountUrl: "https://www.rakuten.com/help/category/account-questions-26578301675411", collectionMethods: [],
    pageCapture: "unavailable", automaticSync: "requires_verified_adapter",
    balanceApiReadiness: "not_verified", balanceUnit: "ambiguous",
    balanceGuidance: "Cash Back USD cannot be imported as points. For Amex or Bilt payout, use that program's balance instead.",
  },
};

export function providerCapabilities(providerId: string): ProviderCapabilities | undefined {
  const capabilities = Object.hasOwn(CAPABILITIES, providerId) ? CAPABILITIES[providerId] : undefined;
  return capabilities ? { ...capabilities, collectionMethods: [...capabilities.collectionMethods] } : undefined;
}
