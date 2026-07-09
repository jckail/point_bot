import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

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
    /** Comma-separated normalized tags. */
    tags: varchar("tags", { length: 512 }).notNull().default(""),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** Soft-delete tombstone; null while the account is active. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (account) => [
    index("loyalty_account_user_id_idx").on(account.userId),
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
  }),
);

export const balanceSnapshots = pgTable(
  "balance_snapshot",
  {
    id: varchar("id", { length: 255 }).notNull().primaryKey(),
    loyaltyAccountId: varchar("loyalty_account_id", { length: 255 })
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
    points: bigint("points", { mode: "number" }).notNull(),
    source: varchar("source", { length: 16 })
      .$type<"sync" | "manual">()
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
    accountId: varchar("account_id", { length: 255 }),
    providerId: varchar("provider_id", { length: 64 }),
    summary: varchar("summary", { length: 512 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (event) => [
    index("activity_event_user_occurred_idx").on(
      event.userId,
      event.occurredAt,
    ),
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
    /**
     * Comma-separated loyalty account ids that count toward this goal.
     * Kept denormalized for a thin first slice; a join table can follow.
     */
    accountIds: varchar("account_ids", { length: 2048 }).notNull().default(""),
    status: varchar("status", { length: 16 })
      .$type<"active" | "achieved" | "archived">()
      .notNull(),
    notes: varchar("notes", { length: 2000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (goal) => [index("trip_goal_user_id_idx").on(goal.userId)],
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
