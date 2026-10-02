import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TransferOptionDto } from "@pointup/core/contracts";
import { expect, it } from "vitest";
import { ValueDealsSection } from "./value-deals-section";

const base: TransferOptionDto = { fromProviderId: "chase-ultimate-rewards", fromDisplayName: "Chase",
  toProviderId: "hyatt", toDisplayName: "Hyatt", sourcePoints: 100_000, destinationPoints: 130_000,
  effectiveCentsPerPoint: 2.21, estimatedValueCents: 221_000, bonusMultiplier: 1.3,
  bonusLabel: "+30% bonus until 2026-10-31", notes: null };
function render(option: TransferOptionDto) {
  return renderToStaticMarkup(createElement(ValueDealsSection, { initialAdvice: { transfers: [option], deals: [] } }));
}
it("labels unverified and unknown legacy bonuses beside the numeric bonus", () => {
  for (const bonusVerified of [false, null, undefined]) {
    expect(render({ ...base, bonusVerified })).toContain("30% bonus · unverified");
  }
});
it("preserves explicit verification and displays supplied provenance", () => {
  const html = render({ ...base, bonusVerified: true, bonusSource: "manual" });
  expect(html).not.toContain("unverified");
  expect(html).toContain("Bonus source: manual");
});
it("does not describe a base ratio without a bonus as unverified", () => {
  const html = render({ ...base, bonusMultiplier: 1, bonusLabel: null, bonusVerified: null, bonusSource: null });
  expect(html).not.toContain("unverified");
  expect(html).not.toContain("% bonus");
});
