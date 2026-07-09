/**
 * Append-only activity log. Surfaces render a chronological feed; the worker
 * can later fan these out as notifications without changing producers.
 */

export const ACTIVITY_TYPES = [
  "account_linked",
  "account_unlinked",
  "account_updated",
  "account_restored",
  "balance_synced",
  "balance_manual",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityEvent {
  readonly id: string;
  readonly userId: string;
  readonly type: ActivityType;
  /** Null when the account was deleted (unlink) or the event is user-scoped. */
  readonly accountId: string | null;
  readonly providerId: string | null;
  /** Optional human-readable detail, e.g. "48,320 miles". */
  readonly summary: string;
  readonly occurredAt: Date;
}

export interface NewActivityEvent {
  readonly userId: string;
  readonly type: ActivityType;
  readonly accountId?: string | null;
  readonly providerId?: string | null;
  readonly summary: string;
  readonly id?: string;
  readonly occurredAt?: Date;
}

export function createActivityEvent(input: NewActivityEvent): ActivityEvent {
  return {
    id: input.id ?? crypto.randomUUID(),
    userId: input.userId,
    type: input.type,
    accountId: input.accountId ?? null,
    providerId: input.providerId ?? null,
    summary: input.summary,
    occurredAt: input.occurredAt ?? new Date(),
  };
}
