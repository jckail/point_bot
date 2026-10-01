import { ShareId, type UserId } from "../shared/ids";
/**
 * Privacy-preserving public share of a portfolio snapshot. The token is the
 * only secret; membership numbers and account ids never appear on the wire.
 */
export interface PortfolioShare {
  readonly id: ShareId;
  readonly userId: UserId;
  /** Opaque public token used in `/share/{token}` URLs. */
  readonly token: string;
  readonly label: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface NewPortfolioShare {
  readonly userId: UserId;
  readonly label?: string | null;
  readonly expiresAt?: Date | null;
  readonly id?: ShareId;
  readonly token?: string;
  readonly now?: Date;
}

export function createPortfolioShare(input: NewPortfolioShare): PortfolioShare {
  const now = input.now ?? new Date();
  const label = input.label?.trim() || null;
  return {
    id: input.id ?? ShareId.generate(),
    userId: input.userId,
    token: input.token ?? crypto.randomUUID().replaceAll("-", ""),
    label: label && label.length > 80 ? label.slice(0, 80) : label,
    createdAt: now,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  };
}

export function revokePortfolioShare(
  share: PortfolioShare,
  at: Date,
): PortfolioShare {
  return { ...share, revokedAt: at };
}

export function isShareActive(share: PortfolioShare, now: Date): boolean {
  if (share.revokedAt) return false;
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}
