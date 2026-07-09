import {
  InvalidMembershipNumberError,
  InvalidAccountNotesError,
  InvalidAccountTagError,
  ProviderNotSupportedError,
} from "../errors";
import {
  getProviderOrThrow,
  isSupportedProvider,
  projectExpiryDate,
} from "./provider";

/**
 * A user's membership in a loyalty program (e.g. their United MileagePlus
 * account).
 *
 * PointUp never stores raw provider passwords. `credentialRef` is an opaque
 * pointer into an external credential vault (1Password item, Apple Keychain
 * entry, Chrome password-manager entry) owned by the user; see
 * docs/integrations.md.
 */
export interface LoyaltyAccount {
  readonly id: string;
  readonly userId: string;
  readonly providerId: string;
  readonly membershipNumber: string;
  readonly credentialRef: string | null;
  /**
   * Projected date the balance expires for inactivity. Null when the program
   * does not expire, or when the user has not set/synced a reference date.
   */
  readonly expiresAt: Date | null;
  /** Free-text note the user attaches to this membership. */
  readonly notes: string | null;
  /** Normalized tags for filtering (e.g. "work", "personal"). */
  readonly tags: readonly string[];
  /** When the user pinned this program to the top of the dashboard. */
  readonly pinnedAt: Date | null;
  /**
   * Soft-delete timestamp. Null while active; set on unlink so the user can
   * undo within the restore window before a hard purge.
   */
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewLoyaltyAccount {
  readonly userId: string;
  readonly providerId: string;
  readonly membershipNumber: string;
  readonly credentialRef?: string | null;
  /** Override the catalog-projected expiry; omit to project from `now`. */
  readonly expiresAt?: Date | null;
  readonly notes?: string | null;
  readonly tags?: readonly string[];
  readonly pinnedAt?: Date | null;
  readonly id?: string;
  readonly now?: Date;
}

function normalizeMembershipNumber(raw: string): string {
  const membershipNumber = raw.trim();
  if (membershipNumber.length === 0) {
    throw new InvalidMembershipNumberError();
  }
  return membershipNumber;
}

export function normalizeAccountNotes(
  notes: string | null | undefined,
): string | null {
  if (notes == null) return null;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 2000) {
    throw new InvalidAccountNotesError();
  }
  return trimmed;
}

/**
 * Lowercases, trims, and de-dupes tags. Empty input → []. Rejects tags that
 * are blank after trim or longer than 32 chars.
 */
export function normalizeAccountTags(
  tags: readonly string[] | null | undefined,
): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag.length === 0) continue;
    if (tag.length > 32 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      throw new InvalidAccountTagError(raw);
    }
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length > 20) {
      throw new InvalidAccountTagError("too many tags (max 20)");
    }
  }
  return result;
}

/** Factory enforcing the entity's invariants. */
export function createLoyaltyAccount(input: NewLoyaltyAccount): LoyaltyAccount {
  if (!isSupportedProvider(input.providerId)) {
    throw new ProviderNotSupportedError(input.providerId);
  }

  const now = input.now ?? new Date();
  const provider = getProviderOrThrow(input.providerId);
  const expiresAt =
    input.expiresAt !== undefined
      ? input.expiresAt
      : projectExpiryDate(provider, now);

  return {
    id: input.id ?? crypto.randomUUID(),
    userId: input.userId,
    providerId: input.providerId,
    membershipNumber: normalizeMembershipNumber(input.membershipNumber),
    credentialRef: input.credentialRef ?? null,
    expiresAt,
    notes: normalizeAccountNotes(input.notes),
    tags: normalizeAccountTags(input.tags),
    pinnedAt: input.pinnedAt ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface LoyaltyAccountChanges {
  /** New membership number; omit to leave unchanged. */
  readonly membershipNumber?: string;
  /** New credential ref; `null` clears it, omit to leave unchanged. */
  readonly credentialRef?: string | null;
  /** New expiry; `null` clears it, omit to leave unchanged. */
  readonly expiresAt?: Date | null;
  /** New notes; `null` clears, omit to leave unchanged. */
  readonly notes?: string | null;
  /** Replace the full tag set; omit to leave unchanged. */
  readonly tags?: readonly string[];
  /** Pin timestamp; `null` unpins, omit to leave unchanged. */
  readonly pinnedAt?: Date | null;
}

/**
 * Returns an updated copy of the account with the same invariants the
 * factory enforces. Mutation rules live here, next to the entity, so use
 * cases can't drift from the creation rules.
 */
export function applyLoyaltyAccountChanges(
  account: LoyaltyAccount,
  changes: LoyaltyAccountChanges,
  updatedAt: Date,
): LoyaltyAccount {
  return {
    ...account,
    membershipNumber:
      changes.membershipNumber !== undefined
        ? normalizeMembershipNumber(changes.membershipNumber)
        : account.membershipNumber,
    credentialRef:
      changes.credentialRef !== undefined
        ? changes.credentialRef
        : account.credentialRef,
    expiresAt:
      changes.expiresAt !== undefined ? changes.expiresAt : account.expiresAt,
    notes:
      changes.notes !== undefined
        ? normalizeAccountNotes(changes.notes)
        : account.notes,
    tags:
      changes.tags !== undefined
        ? normalizeAccountTags(changes.tags)
        : account.tags,
    pinnedAt:
      changes.pinnedAt !== undefined ? changes.pinnedAt : account.pinnedAt,
    updatedAt,
  };
}

/** Soft-delete (unlink) — history is retained until a hard purge. */
export function softDeleteLoyaltyAccount(
  account: LoyaltyAccount,
  at: Date,
): LoyaltyAccount {
  return {
    ...account,
    deletedAt: at,
    pinnedAt: null,
    updatedAt: at,
  };
}

/** Clear the soft-delete tombstone so the account reappears. */
export function restoreLoyaltyAccount(
  account: LoyaltyAccount,
  at: Date,
): LoyaltyAccount {
  return {
    ...account,
    deletedAt: null,
    updatedAt: at,
  };
}

/** Refresh the projected expiry from "now" using the provider's policy. */
export function refreshExpiryFromActivity(
  account: LoyaltyAccount,
  at: Date,
): LoyaltyAccount {
  const provider = getProviderOrThrow(account.providerId);
  return {
    ...account,
    expiresAt: projectExpiryDate(provider, at),
    updatedAt: at,
  };
}

/** Default undo window for soft-deleted accounts (7 days). */
export const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isWithinRestoreWindow(
  account: LoyaltyAccount,
  now: Date,
  windowMs = RESTORE_WINDOW_MS,
): boolean {
  if (!account.deletedAt) return false;
  return now.getTime() - account.deletedAt.getTime() <= windowMs;
}
