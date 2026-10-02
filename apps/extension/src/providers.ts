/** Verified official entry links; evidence and capability limits: docs/provider-capabilities.md. */
export interface GuidedProvider {
  readonly id: string; readonly label: string; readonly currency: string;
  readonly startUrl: string; readonly hosts: readonly string[]; readonly pageReader: boolean; readonly note: string;
}
export const GUIDED_PROVIDERS: readonly GuidedProvider[] = [
  { id: "united", label: "United Airlines", currency: "MileagePlus miles", startUrl: "https://www.united.com/en-US/us/account/", hosts: ["united.com", "www.united.com"], pageReader: true, note: "Use redeemable miles, not status qualification." },
  { id: "delta", label: "Delta Air Lines", currency: "SkyMiles", startUrl: "https://www.delta.com/us/en/need-help/support-skymiles", hosts: ["delta.com", "www.delta.com"], pageReader: true, note: "Use redeemable miles, not qualification or status amounts." },
  { id: "american", label: "American Airlines", currency: "AAdvantage miles", startUrl: "https://www.aa.com/pubcontent/en_US/aadvantage-program/answers-support/aadvantage-support.html", hosts: ["aa.com", "www.aa.com"], pageReader: true, note: "Use AAdvantage miles, not Loyalty Points." },
  { id: "marriott", label: "Marriott Bonvoy", currency: "Bonvoy points", startUrl: "https://www.marriott.com/loyalty.mi", hosts: ["marriott.com", "www.marriott.com"], pageReader: true, note: "Sign in and verify your available points; signed-out templates may show zero." },
  { id: "hilton", label: "Hilton Honors", currency: "Honors points", startUrl: "https://www.hilton.com/en/hilton-honors/", hosts: ["hilton.com", "www.hilton.com"], pageReader: true, note: "Use redeemable Honors points." },
  { id: "hyatt", label: "World of Hyatt", currency: "World of Hyatt points", startUrl: "https://world.hyatt.com/content/gp/en/sign-in.html", hosts: ["hyatt.com", "www.hyatt.com", "world.hyatt.com"], pageReader: true, note: "Complete sign-in yourself, then review the account balance." },
  { id: "chase-ultimate-rewards", label: "Chase Ultimate Rewards", currency: "Ultimate Rewards points", startUrl: "https://www.chase.com/personal/credit-cards/education/rewards-benefits/chase-gift-card", hosts: ["chase.com", "www.chase.com"], pageReader: false, note: "Manual entry: select the correct card/account and available points, excluding pending rewards." },
  { id: "amex-membership-rewards", label: "Amex Membership Rewards", currency: "Membership Rewards points", startUrl: "https://www.americanexpress.com/us/customer-service/faq.how-to-see-mr-points-for-my-card.html", hosts: ["americanexpress.com", "www.americanexpress.com", "global.americanexpress.com"], pageReader: false, note: "Manual entry from Point Summary: confirm the Rewards account and exclude pending points." },
  { id: "capital-one-miles", label: "Capital One Rewards", currency: "Capital One miles", startUrl: "https://www.capitalone.com/credit-cards/rewards/", hosts: ["capitalone.com", "www.capitalone.com", "verified.capitalone.com"], pageReader: false, note: "Manual entry: use miles for the selected card, not dollar-denominated rewards." },
  { id: "citi-thankyou", label: "Citi ThankYou Rewards", currency: "ThankYou Points", startUrl: "https://www.thankyou.com/", hosts: ["thankyou.com", "www.thankyou.com"], pageReader: false, note: "Manual entry from My Account → My Point Summary; exclude pending points." },
  { id: "bilt", label: "Bilt Rewards", currency: "Bilt Points", startUrl: "https://www.bilt.com/", hosts: ["bilt.com", "www.bilt.com", "biltrewards.com", "www.biltrewards.com"], pageReader: false, note: "Manual entry: Bilt Points only. Bilt Cash is a separate USD balance." },
  { id: "amtrak", label: "Amtrak Guest Rewards", currency: "Guest Rewards points", startUrl: "https://www.amtrak.com/guestrewards/account-overview.html", hosts: ["amtrak.com", "www.amtrak.com"], pageReader: false, note: "Manual entry: Available Points only, not Tier Qualifying Points." },
  { id: "rakuten", label: "Rakuten Rewards", currency: "Rakuten points", startUrl: "https://www.rakuten.com/help/category/account-questions-26578301675411", hosts: ["rakuten.com", "www.rakuten.com"], pageReader: false, note: "Cash Back USD cannot be imported as points. For Amex or Bilt payout, use that program's balance instead." },
];
export function guidedProvider(id: string): GuidedProvider | undefined { return GUIDED_PROVIDERS.find(p => p.id === id); }
export function guidedProviderForUrl(raw: string): string | null {
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password
    ? GUIDED_PROVIDERS.find(p => p.hosts.includes(url.hostname))?.id ?? null : null; } catch { return null; }
}
export function validateManualBalance(providerId: string, points: number, unit: string): GuidedProvider {
  const provider = guidedProvider(providerId);
  if (!provider) throw new Error("Choose a supported program.");
  if (providerId === "rakuten") throw new Error("Rakuten payout currency is ambiguous. Open PointUp and choose the actual Amex/Bilt payout program; cash cannot be imported as points.");
  if (unit !== "points") throw new Error("Dollar or cash balances cannot be imported as points. Select the actual points/miles program.");
  if (!Number.isSafeInteger(points) || points < 0) throw new Error("Enter a whole, nonnegative points/miles balance.");
  return provider;
}
