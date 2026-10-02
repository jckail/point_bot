import { InvalidBalanceError } from "../../domain/errors";
import { findCardProduct } from "../../domain/loyalty/card-products";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import { convertPoints, findTransferEdge } from "../../domain/loyalty/transfer-partners";
import { indexBestBonuses } from "../../domain/loyalty/transfer-bonus";
import { resolveTransferEdge } from "../../domain/loyalty/transfer-eligibility";
import { exactPoints } from "../../domain/shared/point-math";
import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
import { systemClock, type Clock } from "../ports";
import type { GetLoyaltyAccount } from "./get-loyalty-account";
import type { ListActiveTransferBonuses } from "./transfer-bonuses";

export interface EstimateTransferInput {
  readonly userId: UserId;
  readonly accountId: LoyaltyAccountId;
  readonly toProviderId: string;
  readonly sourcePoints: number;
}

/** One owned account, one exact route, never a ranked-list proxy or a mutation. */
export class EstimateTransfer {
  constructor(
    private readonly account: Pick<GetLoyaltyAccount, "execute">,
    private readonly bonuses: Pick<ListActiveTransferBonuses, "execute">,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(input: EstimateTransferInput) {
    exactPoints(input.sourcePoints);
    if (input.sourcePoints === 0) throw new InvalidBalanceError();
    const account = await this.account.execute(input.userId, input.accountId);
    const target = getProviderOrThrow(input.toProviderId);
    const bonuses = await this.bonuses.execute(input.userId);
    const now = this.clock.now();
    const selectedCard = account.cardProductId ?? null;
    const savedPoints = account.latestBalance?.points ?? null;
    const base = {
      fromProviderId: account.provider.id, fromDisplayName: account.provider.displayName,
      toProviderId: target.id, toDisplayName: target.displayName,
      selectedCardProductId: selectedCard,
      selectedCardDisplayName: selectedCard ? findCardProduct(selectedCard)?.displayName ?? null : null,
      requestedSourcePoints: input.sourcePoints, savedSourcePoints: savedPoints,
      balanceCapturedAt: account.latestBalance?.capturedAt.toISOString() ?? null,
      hasEnoughSavedPoints: savedPoints === null ? null : savedPoints >= input.sourcePoints,
      evaluatedAt: now.toISOString(),
      caveats: [
        "This is an estimate, not a transfer, booking, or live award availability check.",
        "Card selection is user supplied; ownership, issuer access, and ability to combine cards are not verified.",
        "Saved balances may be stale. Verify the current balance and transfer terms with the issuer before acting.",
      ],
    };
    const candidate = findTransferEdge(account.provider.id, target.id);
    if (!candidate) return { ...base, status: "unavailable" as const, reason: "NO_TRANSFER_ROUTE" as const, estimate: null, eligibilityWarnings: [] };
    const resolution = resolveTransferEdge(candidate, { cardProductId: selectedCard }, now);
    if (resolution.status === "unavailable") return { ...base, status: "unavailable" as const, reason: resolution.warning.code, estimate: null, eligibilityWarnings: [resolution.warning] };
    const edge = resolution.edge;
    // Catalog limits do not establish card-specific issuer eligibility. Unknown
    // fields stay unknown; never borrow limits from another card's agreement.
    const limits = {
      minimumSourcePoints: edge.minimumSourcePoints ?? null,
      incrementSourcePoints: edge.incrementSourcePoints ?? null,
      verification: "catalog_unverified" as const,
      status: edge.minimumSourcePoints === undefined && edge.incrementSourcePoints === undefined
        ? "unknown" as const : "catalog_only" as const,
      amountMatchesCatalog: (edge.minimumSourcePoints === undefined || input.sourcePoints >= edge.minimumSourcePoints)
        && (edge.incrementSourcePoints === undefined || input.sourcePoints % edge.incrementSourcePoints === 0),
    };
    const bestBonus = indexBestBonuses(bonuses, now).get(`${edge.fromProviderId}>${edge.toProviderId}`);
    const multiplierPermille = bestBonus?.multiplierPermille ?? 1000;
    return {
      ...base, status: "estimated" as const, reason: null,
      eligibilityWarnings: [],
      estimate: {
        ratioFrom: edge.ratioFrom, ratioTo: edge.ratioTo,
        baseDestinationPoints: convertPoints(edge, input.sourcePoints),
        destinationPoints: convertPoints(edge, input.sourcePoints, multiplierPermille),
        eligibility: edge.eligibility, limits,
        bonus: bestBonus ? {
          multiplierPermille, source: bestBonus.source, verified: bestBonus.verifiedAt !== null,
          startsAt: bestBonus.startsAt.toISOString(), endsAt: bestBonus.endsAt.toISOString(),
        } : null,
      },
      caveats: [...base.caveats,
        "Transfer limits are catalog information or unknown, not confirmed issuer terms for the selected card.",
        ...(!limits.amountMatchesCatalog ? ["This amount does not satisfy the catalog minimum or increment; adjust it and verify issuer terms."] : []),
        ...(bestBonus && bestBonus.verifiedAt === null ? ["The applied bonus is unverified; confirm it with the issuer."] : []),
      ],
    };
  }
}
