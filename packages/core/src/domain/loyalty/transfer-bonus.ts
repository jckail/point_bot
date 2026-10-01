import { InvalidTransferBonusError } from "../errors";
import { findProvider } from "./provider";
import { applyBonusPermille } from "./bonus-math";
import { findTransferEdge } from "./transfer-partners";

export { applyBonusPermille };

/**
 * Transfer bonuses are REAL data, not editorial samples: a time-boxed
 * multiplier on one edge of the transfer graph (e.g. +30% Chase UR -> Hyatt).
 * There are none by default. They come from manual entry, a scraper, or user
 * reports, and unverified ones are flagged as such wherever they are used.
 */

export const TRANSFER_BONUS_SOURCES = ["manual", "scraped", "user"] as const;
export type TransferBonusSource = (typeof TRANSFER_BONUS_SOURCES)[number];

export function isTransferBonusSource(
  value: unknown,
): value is TransferBonusSource {
  return (
    typeof value === "string" &&
    (TRANSFER_BONUS_SOURCES as readonly string[]).includes(value)
  );
}

/** Multipliers are stored as integer permille: 1300 = 1.3x (a +30% bonus). */
export const MIN_BONUS_PERMILLE_EXCLUSIVE = 1000;
export const MAX_BONUS_PERMILLE = 3000;

export interface TransferBonus {
  readonly id: string;
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly multiplierPermille: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly source: TransferBonusSource;
  readonly sourceUrl: string | null;
  /** Set when a human confirmed the bonus against the issuer's announcement. */
  readonly verifiedAt: Date | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

export interface NewTransferBonus {
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly multiplierPermille: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly source: TransferBonusSource;
  readonly sourceUrl?: string | null;
  readonly verifiedAt?: Date | null;
  readonly createdBy?: string | null;
  readonly id?: string;
  readonly now?: Date;
}

export interface TransferBonusRepository {
  insert(bonus: TransferBonus): Promise<void>;
  /** Bonuses whose window contains `at` (starts <= at <= ends), newest first. */
  findActive(at: Date): Promise<TransferBonus[]>;
  findById(id: string): Promise<TransferBonus | null>;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidTransferBonusError(`${label} must be a valid date`);
  }
}

/** Factory enforcing every invariant of a bonus. */
export function createTransferBonus(input: NewTransferBonus): TransferBonus {
  if (!findProvider(input.fromProviderId)) {
    throw new InvalidTransferBonusError(
      `Unknown source program "${input.fromProviderId}"`,
    );
  }
  if (!findProvider(input.toProviderId)) {
    throw new InvalidTransferBonusError(
      `Unknown destination program "${input.toProviderId}"`,
    );
  }
  if (!findTransferEdge(input.fromProviderId, input.toProviderId)) {
    throw new InvalidTransferBonusError(
      `There is no transfer path from "${input.fromProviderId}" to "${input.toProviderId}"`,
    );
  }
  if (!isTransferBonusSource(input.source)) {
    throw new InvalidTransferBonusError("Unknown bonus source");
  }
  if (
    !Number.isInteger(input.multiplierPermille) ||
    input.multiplierPermille <= MIN_BONUS_PERMILLE_EXCLUSIVE ||
    input.multiplierPermille > MAX_BONUS_PERMILLE
  ) {
    throw new InvalidTransferBonusError(
      "Multiplier must be greater than 1.0 and at most 3.0 (integer permille, e.g. 1300 for +30%)",
    );
  }
  assertValidDate(input.startsAt, "startsAt");
  assertValidDate(input.endsAt, "endsAt");
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new InvalidTransferBonusError("endsAt must be after startsAt");
  }
  const sourceUrl = input.sourceUrl?.trim() || null;
  if (sourceUrl) {
    try {
      const protocol = new URL(sourceUrl).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new Error();
    } catch {
      throw new InvalidTransferBonusError("sourceUrl must be an http(s) URL");
    }
    if (sourceUrl.length > 2048) {
      throw new InvalidTransferBonusError("sourceUrl is too long");
    }
  }
  return {
    id: input.id ?? crypto.randomUUID(),
    fromProviderId: input.fromProviderId,
    toProviderId: input.toProviderId,
    multiplierPermille: input.multiplierPermille,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    source: input.source,
    sourceUrl,
    verifiedAt: input.verifiedAt ?? null,
    createdBy: input.createdBy ?? null,
    createdAt: input.now ?? new Date(),
  };
}

export function isBonusActive(bonus: TransferBonus, at: Date): boolean {
  return (
    bonus.startsAt.getTime() <= at.getTime() &&
    bonus.endsAt.getTime() >= at.getTime()
  );
}

/** Human label, e.g. "+30% bonus until 2026-10-31". */
export function describeBonus(bonus: TransferBonus): string {
  const pct = (bonus.multiplierPermille - 1000) / 10;
  const until = bonus.endsAt.toISOString().slice(0, 10);
  return `+${Number.isInteger(pct) ? pct : pct.toFixed(1)}% bonus until ${until}`;
}

/** Best (highest-multiplier) active bonus per edge, keyed "from>to". */
export function indexBestBonuses(
  bonuses: readonly TransferBonus[],
  at: Date,
): Map<string, TransferBonus> {
  const best = new Map<string, TransferBonus>();
  for (const bonus of bonuses) {
    if (!isBonusActive(bonus, at)) continue;
    const key = `${bonus.fromProviderId}>${bonus.toProviderId}`;
    const current = best.get(key);
    if (
      !current ||
      bonus.multiplierPermille > current.multiplierPermille ||
      (bonus.multiplierPermille === current.multiplierPermille &&
        bonus.id < current.id)
    ) {
      best.set(key, bonus);
    }
  }
  return best;
}
