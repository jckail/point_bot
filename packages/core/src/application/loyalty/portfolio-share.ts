import {
  ShareLinkNotFoundError,
} from "../../domain/errors";
import {
  createPortfolioShare,
  isShareActive,
  revokePortfolioShare,
  type PortfolioShare,
} from "../../domain/loyalty/portfolio-share";
import type {
  PortfolioShareRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import {
  computePortfolioSummary,
  type PortfolioSummaryReadModel,
} from "./get-portfolio-summary";
import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { ProviderKind } from "../../domain/loyalty/provider";

export interface CreatePortfolioShareInput {
  readonly userId: string;
  readonly label?: string | null;
  /** Days until expiry; omit for no expiry. */
  readonly expiresInDays?: number | null;
}

export interface PortfolioShareReadModel {
  readonly id: string;
  readonly token: string;
  readonly label: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly active: boolean;
}

export interface PublicPortfolioSnapshot {
  readonly label: string | null;
  readonly totalPoints: number;
  readonly totalValueCents: number;
  readonly accountCount: number;
  readonly byKind: PortfolioSummaryReadModel["byKind"];
  /** Program display names only — no membership numbers or ids. */
  readonly programs: readonly {
    readonly displayName: string;
    readonly kind: ProviderKind;
    readonly points: number;
    readonly valueCents: number;
  }[];
  readonly generatedAt: Date;
}

function toShareReadModel(
  share: PortfolioShare,
  now: Date,
): PortfolioShareReadModel {
  return {
    id: share.id,
    token: share.token,
    label: share.label,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    active: isShareActive(share, now),
  };
}

export class CreatePortfolioShare {
  constructor(
    private readonly shares: PortfolioShareRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    input: CreatePortfolioShareInput,
  ): Promise<PortfolioShareReadModel> {
    const now = this.clock.now();
    const expiresAt =
      input.expiresInDays != null && input.expiresInDays > 0
        ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const share = createPortfolioShare({
      userId: input.userId,
      label: input.label,
      expiresAt,
      now,
    });
    await this.shares.insert(share);
    return toShareReadModel(share, now);
  }
}

export class ListPortfolioShares {
  constructor(
    private readonly shares: PortfolioShareRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string): Promise<PortfolioShareReadModel[]> {
    const shares = await this.shares.findByUserId(userId);
    const now = this.clock.now();
    return shares.map((share) => toShareReadModel(share, now));
  }
}

export class RevokePortfolioShare {
  constructor(
    private readonly shares: PortfolioShareRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string, shareId: string): Promise<void> {
    const share = await this.shares.findById(shareId);
    if (!share || share.userId !== userId) {
      throw new ShareLinkNotFoundError();
    }
    await this.shares.update(revokePortfolioShare(share, this.clock.now()));
  }
}

/**
 * Resolves a public share token to a privacy-preserving portfolio snapshot.
 * No auth required — the token is the capability.
 */
export class GetPublicPortfolioSnapshot {
  constructor(
    private readonly shares: PortfolioShareRepository,
    private readonly listAccounts: ListLoyaltyAccounts,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(token: string): Promise<PublicPortfolioSnapshot> {
    const share = await this.shares.findByToken(token);
    const now = this.clock.now();
    if (!share || !isShareActive(share, now)) {
      throw new ShareLinkNotFoundError();
    }

    const accounts = await this.listAccounts.execute(share.userId);
    const summary = computePortfolioSummary(accounts);

    return {
      label: share.label,
      totalPoints: summary.totalPoints,
      totalValueCents: summary.totalValueCents,
      accountCount: summary.accountCount,
      byKind: summary.byKind,
      programs: accounts
        .map((account) => ({
          displayName: account.provider.displayName,
          kind: account.provider.kind,
          points: account.latestBalance?.points ?? 0,
          valueCents: account.estimatedValueCents,
        }))
        .sort((a, b) => b.valueCents - a.valueCents),
      generatedAt: now,
    };
  }
}
