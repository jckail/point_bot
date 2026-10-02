import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** Server-only immutable proposals and their single-use execution journal. */
export const assistantActions = pgTable("assistant_action", {
  id: varchar("id", { length: 255 }).notNull().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 32 }).$type<"manual_balance" | "trip_goal">().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: varchar("status", { length: 16 }).$type<"pending" | "executing" | "succeeded" | "rejected" | "expired" | "failed" | "unknown">().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  failureCode: varchar("failure_code", { length: 64 }),
}, row => [
  index("assistant_action_user_status_idx").on(row.userId, row.status),
  check("assistant_action_kind_check", sql`${row.kind} IN ('manual_balance', 'trip_goal')`),
  check("assistant_action_status_check", sql`${row.status} IN ('pending', 'executing', 'succeeded', 'rejected', 'expired', 'failed', 'unknown')`),
  check("assistant_action_payload_check", sql`jsonb_typeof(${row.payload}) = 'object'`),
  check("assistant_action_expiry_check", sql`${row.expiresAt} > ${row.createdAt}`),
]).enableRLS();

/**
 * Identity lives in Clerk (https://clerk.com); PointUp stores only the Clerk
 * user id (`user_id` columns) alongside domain data. There are no local
 * user/session tables to keep in sync.
 */

// ─── Loyalty domain ────────────────────────────────────────────────────────

export const loyaltyAccounts = pgTable(
  "loyalty_account",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    /** Clerk user id, e.g. "user_2abc...". */
    userId: varchar("user_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    membershipNumber: varchar("membership_number", { length: 255 }).notNull(),
    /**
     * Opaque pointer into an external credential vault (1Password item,
     * keychain entry). Raw credentials are never stored.
     */
    credentialRef: varchar("credential_ref", { length: 512 }),
    /** Projected inactivity expiry; null when the program does not expire. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    notes: varchar("notes", { length: 2000 }),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** Soft-delete tombstone; null while the account is active. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (account) => [
    // Active accounts per user (worker `listUserIds`, per-user reads). The
    // plain (user_id) index was dropped: the (user_id, provider_id) unique
    // index below serves every user_id-prefix lookup (docs/performance.md).
    index("loyalty_account_active_user_idx")
      .on(account.userId)
      .where(sql`${account.deletedAt} is null`),
    index("loyalty_account_expires_at_idx").on(account.expiresAt),
    index("loyalty_account_deleted_at_idx").on(account.deletedAt),
    // One account per provider per user, enforced at the storage layer so
    // concurrent link requests cannot race past the application check.
    uniqueIndex("loyalty_account_user_provider_unique").on(
      account.userId,
      account.providerId,
    ),
  ],
);

export const loyaltyAccountsRelations = relations(
  loyaltyAccounts,
  ({ many }) => ({
    balanceSnapshots: many(balanceSnapshots),
    tags: many(accountTags),
  }),
);

/** Normalized account tags; `position` preserves the user's tag order. */
export const accountTags = pgTable(
  "account_tag",
  {
    accountId: varchar("account_id", { length: 255 })
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 64 }).notNull(),
    position: integer("position").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.accountId, row.tag] }),
    index("account_tag_tag_idx").on(row.tag),
  ],
);

export const accountTagsRelations = relations(accountTags, ({ one }) => ({
  account: one(loyaltyAccounts, {
    fields: [accountTags.accountId],
    references: [loyaltyAccounts.id],
  }),
}));

export const balanceSnapshots = pgTable(
  "balance_snapshot",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    loyaltyAccountId: varchar("loyalty_account_id", { length: 255 })
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    points: bigint("points", { mode: "number" }).notNull(),
    source: varchar("source", { length: 16 })
      .$type<"sync" | "manual" | "agent">()
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (snapshot) => [
    index("balance_snapshot_account_captured_idx").on(
      snapshot.loyaltyAccountId,
      snapshot.capturedAt,
    ),
  ],
);

export const balanceSnapshotsRelations = relations(
  balanceSnapshots,
  ({ one }) => ({
    loyaltyAccount: one(loyaltyAccounts, {
      fields: [balanceSnapshots.loyaltyAccountId],
      references: [loyaltyAccounts.id],
    }),
  }),
);

// ─── Activity feed ─────────────────────────────────────────────────────────

export const activityEvents = pgTable(
  "activity_event",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    accountId: varchar("account_id", { length: 255 }).references(
      () => loyaltyAccounts.id,
      { onDelete: "set null" },
    ),
    providerId: varchar("provider_id", { length: 64 }),
    summary: varchar("summary", { length: 512 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (event) => [
    index("activity_event_user_occurred_idx").on(
      event.userId,
      event.occurredAt,
    ),
    // Retention purge by age across all users (a seq scan per batch without it).
    index("activity_event_occurred_idx").on(event.occurredAt),
  ],
);

// ─── Trip goals ────────────────────────────────────────────────────────────

export const tripGoals = pgTable(
  "trip_goal",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    targetPoints: bigint("target_points", { mode: "number" }).notNull(),
    /** Optional calendar date (YYYY-MM-DD) stored as text. */
    targetDate: varchar("target_date", { length: 10 }),
    status: varchar("status", { length: 16 })
      .$type<"active" | "achieved" | "archived">()
      .notNull(),
    notes: varchar("notes", { length: 2000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (goal) => [index("trip_goal_user_id_idx").on(goal.userId)],
);

/** Accounts counting toward a goal; `position` preserves ordering. */
export const tripGoalAccounts = pgTable(
  "trip_goal_account",
  {
    goalId: varchar("goal_id", { length: 255 })
      .notNull()
      .references(() => tripGoals.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 })
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.goalId, row.accountId] }),
    index("trip_goal_account_account_idx").on(row.accountId),
  ],
);

// ─── Custom valuations ─────────────────────────────────────────────────────
// Per-user override of a provider's editorial cents-per-point. Stored as an
// integer number of milli-cents (centsPerPoint × 1000) to avoid float drift.

export const userProviderValuations = pgTable(
  "user_provider_valuation",
  {
    userId: varchar("user_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    centsPerPointMilli: integer("cents_per_point_milli").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (row) => [primaryKey({ columns: [row.userId, row.providerId] })],
);

// ─── User settings ─────────────────────────────────────────────────────────
// One row per user; extended column-by-column as preferences accrue.

export const userSettings = pgTable("user_setting", {
  userId: varchar("user_id", { length: 255 }).notNull().primaryKey(),
  /** ISO 4217 display currency, e.g. "EUR". Values stay USD internally. */
  displayCurrency: varchar("display_currency", { length: 3 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// ─── Award watchlist ───────────────────────────────────────────────────────
// Watched award/deal pages, re-scraped on a schedule. Cents-per-point values
// are stored as integer milli-cents (× 1000) like custom valuations.

export const awardWatches = pgTable(
  "award_watch",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    minCentsPerPointMilli: integer("min_cents_per_point_milli").notNull(),
    bestSeenCentsPerPointMilli: integer("best_seen_cents_per_point_milli"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (watch) => [index("award_watch_user_id_idx").on(watch.userId)],
);

// ─── Public portfolio shares ───────────────────────────────────────────────

export const portfolioShares = pgTable(
  "portfolio_share",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    label: varchar("label", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (share) => [
    index("portfolio_share_user_id_idx").on(share.userId),
    uniqueIndex("portfolio_share_token_unique").on(share.token),
  ],
);

// ─── Agent bounded context ─────────────────────────────────────────────────
// Personal access tokens (hashed), per-provider consent grants, and an
// append-only audit trail of everything an agent wrote back.

export const accessTokens = pgTable(
  "access_token",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    displayPrefix: varchar("display_prefix", { length: 16 }).notNull(),
    /** SHA-256 hex of the plaintext token; the plaintext is never stored. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** Space-separated scope names. */
    scopes: varchar("scopes", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (token) => [
    index("access_token_user_id_idx").on(token.userId),
    uniqueIndex("access_token_hash_unique").on(token.tokenHash),
  ],
);

export const consentGrants = pgTable(
  "consent_grant",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (consent) => [
    index("consent_grant_user_id_idx").on(consent.userId),
    // At most one non-revoked grant per (user, provider). Expiry cannot be in
    // the predicate, so grants revoke expired rows before inserting.
    uniqueIndex("consent_grant_one_open")
      .on(consent.userId, consent.providerId)
      .where(sql`${consent.revokedAt} is null`),
  ],
);

export const agentObservations = pgTable(
  "agent_observation",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    accountId: varchar("account_id", { length: 255 })
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    skillId: varchar("skill_id", { length: 96 }).notNull(),
    agent: varchar("agent", { length: 64 }).notNull(),
    sourceHost: varchar("source_host", { length: 255 }).notNull(),
    points: bigint("points", { mode: "number" }).notNull(),
    /** Latest balance when written; lets a human confirmation detect drift. */
    previousPoints: bigint("previous_points", { mode: "number" }),
    outcome: varchar("outcome", { length: 16 })
      .$type<"recorded" | "unchanged" | "needs_review" | "rejected">()
      .notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (row) => [
    index("agent_observation_user_created_idx").on(row.userId, row.createdAt),
  ],
);

export const tripGoalsRelations = relations(tripGoals, ({ many }) => ({
  accounts: many(tripGoalAccounts),
}));

export const tripGoalAccountsRelations = relations(
  tripGoalAccounts,
  ({ one }) => ({
    goal: one(tripGoals, {
      fields: [tripGoalAccounts.goalId],
      references: [tripGoals.id],
    }),
  }),
);

/**
 * Transactional outbox for domain events: rows are inserted in the same
 * transaction as the state change and delivered at-least-once by the worker's
 * `outbox` job (see docs/events.md).
 */
export const domainEventOutbox = pgTable(
  "domain_event_outbox",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    /** Payload schema version for this event type. */
    version: integer("version").notNull().default(1),
    userId: varchar("user_id", { length: 255 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    correlationId: varchar("correlation_id", { length: 255 }),
    attempts: integer("attempts").notNull().default(0),
    /** Not claimable before this time (retry backoff / claim lease). */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Set when attempts were exhausted; the row is kept for inspection. */
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: varchar("last_error", { length: 1000 }),
  },
  (row) => [
    // Claim index: matches the claim query's full ORDER BY so Postgres stops
    // after `limit` rows; only rows still waiting for delivery.
    index("domain_event_outbox_claim_idx")
      .on(row.availableAt, row.occurredAt, row.id)
      .where(sql`${row.processedAt} is null and ${row.deadLetteredAt} is null`),
    // Retention purge by age (processed rows are in no other index).
    index("domain_event_outbox_processed_idx")
      .on(row.processedAt)
      .where(sql`${row.processedAt} is not null`),
    index("domain_event_outbox_aggregate_idx").on(row.aggregateId),
    index("domain_event_outbox_user_idx").on(row.userId, row.occurredAt),
  ],
);

// ─── Transfer bonuses ──────────────────────────────────────────────────────
// Time-boxed bonus windows on a transfer-graph edge. Global (not per-user)
// reference data: empty by default, filled by manual entry, scraping or
// user reports. `multiplier_permille` is an integer (1300 = +30%).

export const transferBonuses = pgTable(
  "transfer_bonus",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    fromProviderId: varchar("from_provider_id", { length: 64 }).notNull(),
    toProviderId: varchar("to_provider_id", { length: 64 }).notNull(),
    multiplierPermille: integer("multiplier_permille").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** 'manual' | 'scraped' | 'user' (see TRANSFER_BONUS_SOURCES). */
    source: varchar("source", { length: 16 }).notNull(),
    sourceUrl: varchar("source_url", { length: 2048 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (bonus) => [
    index("transfer_bonus_window_idx").on(bonus.endsAt, bonus.startsAt),
    index("transfer_bonus_edge_idx").on(bonus.fromProviderId, bonus.toProviderId),
    check(
      "transfer_bonus_multiplier_range",
      sql`${bonus.multiplierPermille} > 1000 and ${bonus.multiplierPermille} <= 3000`,
    ),
    check("transfer_bonus_window_order", sql`${bonus.endsAt} > ${bonus.startsAt}`),
  ],
);
