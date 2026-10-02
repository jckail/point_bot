import { InvalidBalanceError } from "../errors";
import { findCardProduct, type CardProductId } from "./card-products";
import type { ProviderId } from "./provider";

/** Editorial graph edges require account-specific resolution before calculation. */
export interface TransferEdge {
  readonly fromProviderId: ProviderId;
  readonly toProviderId: ProviderId;
  readonly ratioFrom: number;
  readonly ratioTo: number;
  readonly notes?: string;
  readonly minimumSourcePoints?: number;
  readonly incrementSourcePoints?: number;
}
export interface TransferAccountContext { readonly cardProductId?: CardProductId | null }
export const TRANSFER_ELIGIBILITY_CODES = ["CARD_PRODUCT_REQUIRED", "CARD_PRODUCT_UNVERIFIED", "TRANSFER_RULE_NOT_EFFECTIVE"] as const;
export interface TransferEligibilityWarning {
  readonly code: (typeof TRANSFER_ELIGIBILITY_CODES)[number];
  readonly fromProviderId: ProviderId;
  readonly toProviderId: ProviderId;
  readonly cardProductId: CardProductId | null;
  readonly message: string;
}
export interface TransferEligibilityMetadata {
  readonly ruleId: string;
  readonly sourceUrl: string | null;
  readonly effectiveFrom: string | null;
  readonly evaluatedAt: string;
  readonly cardProductId: CardProductId | null;
}
declare const resolvedBrand: unique symbol;
export interface ResolvedTransferEdge extends TransferEdge {
  readonly [resolvedBrand]: true;
  readonly eligibility: TransferEligibilityMetadata;
}
export type TransferResolution = { readonly status: "resolved"; readonly edge: ResolvedTransferEdge }
  | { readonly status: "unavailable"; readonly warning: TransferEligibilityWarning };

// Object identity plus freezing prevents casts/clones/mutation from forging a rule.
const resolvedEdges = new WeakSet<object>();
export function isConditionalTransfer(edge: TransferEdge): boolean {
  return edge.fromProviderId === "chase-ultimate-rewards" && edge.toProviderId === "hyatt";
}
export function assertTransferCalculationAllowed(edge: TransferEdge): void {
  if (isConditionalTransfer(edge) && !resolvedEdges.has(edge)) throw new InvalidBalanceError();
}

/** No historical or unverified product ratios are inferred from account notes. */
export function resolveTransferEdge(edge: TransferEdge, context: TransferAccountContext = {}, now: Date = new Date()): TransferResolution {
  if (!Number.isFinite(now.getTime())) throw new InvalidBalanceError();
  const cardProductId = context.cardProductId ?? null;
  const evaluatedAt = now.toISOString();
  const unavailable = (code: TransferEligibilityWarning["code"], message: string): TransferResolution => ({
    status: "unavailable", warning: { code, fromProviderId: edge.fromProviderId, toProviderId: edge.toProviderId, cardProductId, message },
  });
  let ratioFrom = edge.ratioFrom;
  let ratioTo = edge.ratioTo;
  let ruleId = "catalog-transfer";
  let sourceUrl: string | null = null;
  let effectiveFrom: string | null = null;
  let notes = edge.notes;
  if (isConditionalTransfer(edge)) {
    if (!cardProductId) return unavailable("CARD_PRODUCT_REQUIRED", "Select the Chase card used for this transfer in account Details before calculating Chase to Hyatt eligibility.");
    const product = findCardProduct(cardProductId);
    if (!product || product.providerId !== edge.fromProviderId || !["chase-sapphire-preferred", "chase-ink-business-preferred", "chase-ink-plus", "chase-corporate-flex"].includes(cardProductId)) {
      return unavailable("CARD_PRODUCT_UNVERIFIED", "The selected card's Chase to Hyatt rule is not verified. Check its issuer terms and use another verified funding source.");
    }
    effectiveFrom = "2026-10-01T00:00:00.000Z";
    if (now.getTime() < Date.parse(effectiveFrom)) return unavailable("TRANSFER_RULE_NOT_EFFECTIVE", "The selected card's Chase to Hyatt rule is only verified from October 1, 2026. Earlier dates cannot be calculated reliably.");
    ratioFrom = 4;
    ratioTo = 3;
    ruleId = "chase-hyatt-affected-2026-10-01";
    sourceUrl = "https://media.chase.com/news/Meet-the-New-Chase-Sapphire-Preferred";
    notes = "Selected eligible Preferred/Ink card: 4 Chase points transfer to 3 Hyatt points from October 1, 2026.";
  }
  const resolved = Object.freeze({ ...edge, ratioFrom, ratioTo, notes,
    eligibility: Object.freeze({ ruleId, sourceUrl, effectiveFrom, evaluatedAt, cardProductId }) }) as ResolvedTransferEdge;
  resolvedEdges.add(resolved);
  return { status: "resolved", edge: resolved };
}
