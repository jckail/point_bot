import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  jsonb,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  text,
  unique,
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
    tags: text("tags").notNull().default(""),
    /** Canonical lossless tags; legacy tags remain for older writers. */
    tagValues: text("tag_values").array().notNull().default(sql`ARRAY[]::text[]`),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** Soft-delete tombstone; null while the account is active. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (account) => [
    index("loyalty_account_user_id_idx").on(account.userId),
    uniqueIndex("loyalty_account_id_user_unique").on(account.id, account.userId),
    uniqueIndex("loyalty_account_id_user_provider_unique").on(account.id, account.userId, account.providerId),
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
    check("balance_snapshot_points_check", sql`${snapshot.points} >= 0 AND ${snapshot.points} <= 9007199254740991`),
    check("balance_snapshot_source_check", sql`${snapshot.source} IN ('sync', 'manual')`),
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
     * Legacy compatibility projection; canonical reads use trip_goal_account.
     */
    accountIds: text("account_ids").notNull().default(""),
    status: varchar("status", { length: 16 })
      .$type<"active" | "achieved" | "archived">()
      .notNull(),
    notes: varchar("notes", { length: 2000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (goal) => [
    index("trip_goal_user_id_idx").on(goal.userId),
    uniqueIndex("trip_goal_id_user_unique").on(goal.id, goal.userId),
    check("trip_goal_target_points_check", sql`${goal.targetPoints} > 0 AND ${goal.targetPoints} <= 9007199254740991`),
    check("trip_goal_status_check", sql`${goal.status} IN ('active', 'achieved', 'archived')`),
  ],
);

/** Tenant-qualified goal memberships, ordered as supplied by the owner. */
export const tripGoalAccounts = pgTable("trip_goal_account", {
  goalId: varchar("goal_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  loyaltyAccountId: varchar("loyalty_account_id", { length: 255 }).notNull(),
  position: integer("position").notNull(),
}, (row) => [
  primaryKey({ columns: [row.goalId, row.loyaltyAccountId] }),
  foreignKey({ columns: [row.goalId, row.userId], foreignColumns: [tripGoals.id, tripGoals.userId], name: "trip_goal_account_owned_goal_fk" }).onDelete("cascade"),
  foreignKey({ columns: [row.loyaltyAccountId, row.userId], foreignColumns: [loyaltyAccounts.id, loyaltyAccounts.userId], name: "trip_goal_account_owned_account_fk" }).onDelete("cascade"),
  check("trip_goal_account_position_check", sql`${row.position} >= 0`),
]);

/** Preserved invalid legacy links for operator review; never used for progress. */
export const tripGoalMembershipReviews = pgTable("trip_goal_membership_review", {
  goalId: varchar("goal_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  accountId: text("account_id").notNull(),
  reason: text("reason").notNull(),
  legacyAccountIds: text("legacy_account_ids").notNull(),
}, (row) => [primaryKey({ columns: [row.goalId, row.accountId] })]).enableRLS();

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


// Durable scoped tokens. Plaintext secrets are returned once and never stored.
export const agentTokens = pgTable("agent_token", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (row) => [
  uniqueIndex("agent_token_hash_unique").on(row.tokenHash),
  uniqueIndex("agent_token_id_user_unique").on(row.id, row.userId),
  index("agent_token_user_idx").on(row.userId),
  check("agent_token_expiry_check", sql`${row.expiresAt} > ${row.createdAt} AND ${row.expiresAt} <= ${row.createdAt} + interval '90 days'`),
  check("agent_token_hash_check", sql`${row.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("agent_token_scopes_check", sql`jsonb_typeof(${row.scopes}) = 'array' AND jsonb_array_length(${row.scopes}) > 0 AND ${row.scopes} <@ '["portfolio:read","portfolio:write","observations:write","sync:execute","shares:write","assistant:chat","actions:propose"]'::jsonb`),
]).enableRLS();
export const observationConsents = pgTable("observation_consent", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  accountId: varchar("account_id", { length: 255 }).notNull(),
  providerId: varchar("provider_id", { length: 64 }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (row) => [
  index("observation_consent_user_account_idx").on(row.userId, row.accountId),
  uniqueIndex("observation_consent_identity_unique").on(row.id, row.userId, row.accountId, row.providerId),
  foreignKey({ columns: [row.accountId, row.userId, row.providerId], foreignColumns: [loyaltyAccounts.id, loyaltyAccounts.userId, loyaltyAccounts.providerId], name: "observation_consent_owned_account_fk" }).onDelete("cascade"),
  check("observation_consent_expiry_check", sql`${row.expiresAt} > ${row.grantedAt} AND ${row.expiresAt} <= ${row.grantedAt} + interval '30 days'`),
]).enableRLS();
export const agentObservations = pgTable("agent_observation", {
  id: varchar("id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  tokenId: varchar("token_id", { length: 255 }).notNull(),
  consentId: varchar("consent_id", { length: 255 }).notNull(),
  accountId: varchar("account_id", { length: 255 }).notNull(),
  providerId: varchar("provider_id", { length: 64 }).notNull(),
  points: bigint("points", { mode: "number" }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  sourceHost: varchar("source_host", { length: 255 }).notNull(),
  sourceMethod: varchar("source_method", { length: 32 }).$type<"page_capture" | "manual_entry">().notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).$type<"accepted" | "held" | "rejected">().notNull(),
  holdReason: varchar("hold_reason", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  snapshotId: varchar("snapshot_id", { length: 255 }).references(() => balanceSnapshots.id, { onDelete: "set null" }),
}, (row) => [
  primaryKey({ columns: [row.userId, row.id] }),
  index("agent_observation_user_status_idx").on(row.userId, row.status, row.createdAt),
  foreignKey({ columns: [row.tokenId, row.userId], foreignColumns: [agentTokens.id, agentTokens.userId], name: "agent_observation_owned_token_fk" }),
  foreignKey({ columns: [row.consentId, row.userId, row.accountId, row.providerId], foreignColumns: [observationConsents.id, observationConsents.userId, observationConsents.accountId, observationConsents.providerId], name: "agent_observation_owned_consent_fk" }).onDelete("cascade"),
  check("agent_observation_points_check", sql`${row.points} >= 0 AND ${row.points} <= 9007199254740991`),
  check("agent_observation_status_check", sql`${row.status} IN ('accepted', 'held', 'rejected')`),
  check("agent_observation_method_check", sql`${row.sourceMethod} IN ('page_capture', 'manual_entry')`),
]).enableRLS();
export const assistantActions = pgTable("assistant_action", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 32 }).$type<"manual_balance" | "trip_goal">().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: varchar("status", { length: 16 }).$type<"pending" | "executing" | "succeeded" | "rejected" | "expired" | "failed" | "unknown">().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  failureCode: varchar("failure_code", { length: 64 }),
}, (row) => [
  index("assistant_action_user_status_idx").on(row.userId, row.status),
  check("assistant_action_kind_check", sql`${row.kind} IN ('manual_balance', 'trip_goal')`),
  check("assistant_action_status_check", sql`${row.status} IN ('pending', 'executing', 'succeeded', 'rejected', 'expired', 'failed', 'unknown')`),
]).enableRLS();


// Managed server-only SIWC storage; no browser-accessible policies.
export const chatGptTransactions = pgTable("pointup_chatgpt_transactions", {
  browserIdHash: text("browser_id_hash").primaryKey(),
  transactionData: jsonb("transaction_data").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (row) => [index("pointup_chatgpt_transactions_expiry").on(row.expiresAt)]).enableRLS();
export const chatGptIdentities = pgTable("pointup_chatgpt_identities", {
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  subject: text("subject").notNull(),
  clerkUserId: text("clerk_user_id").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
}, (row) => [
  primaryKey({ name: "pointup_chatgpt_identities_pkey", columns: [row.issuer, row.clientId, row.subject] }),
  unique("pointup_chatgpt_identities_issuer_client_id_clerk_user_id_key").on(row.issuer, row.clientId, row.clerkUserId),
]).enableRLS();
