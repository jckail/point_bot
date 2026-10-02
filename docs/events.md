# Domain events and the transactional outbox

Use cases record **typed domain events** for the facts that matter (an account
was linked, a balance was recorded, a consent was revoked, ...). Events are
written to the `domain_event_outbox` table in the **same database transaction**
as the state change, and a worker job delivers them to in-process handlers.

The existing `activity_event` feed is unchanged and still written directly; it
is not derived from the outbox (yet).

## Event model

Defined in `packages/core/src/domain/events/`. Each event has:

| Field | Meaning |
| --- | --- |
| `id` | Unique event id (UUID); the idempotency key for handlers |
| `type` | One of `EVENT_TYPES` (a `const` tuple, so the union is closed) |
| `occurredAt` | When the fact happened |
| `userId` | Owner of the data |
| `aggregateId` | Id of the entity concerned (account, consent, token, goal, ...) |
| `version` | Payload schema version for this type (`EVENT_SCHEMA_VERSIONS`) |
| `payload` | Typed per `type` (`EventPayloads`); dates are ISO strings |
| `correlationId?` | Request/trace id when known |

`DomainEvent` is a discriminated union on `type`; use `assertNever` in a
`switch` to get compile-time exhaustiveness (see `describeEvent`).

Payloads never contain membership numbers, credential refs, token plaintext or
hashes, token/goal titles, notes, URLs, or emails. Updates list changed field
**names** only.

## Catalogue

| Type | Emitted by | Aggregate | Payload |
| --- | --- | --- | --- |
| `account.linked` | `LinkLoyaltyAccount` | account | `providerId` |
| `account.updated` | `UpdateLoyaltyAccount` | account | `providerId`, `changed[]` |
| `account.unlinked` | `UnlinkLoyaltyAccount` | account | `providerId` |
| `account.restored` | `RestoreLoyaltyAccount` | account | `providerId` |
| `balance.recorded` | `RecordManualBalance` (`manual`/`agent`), `SyncLoyaltyAccount` (`sync`) | account | `accountId`, `providerId`, `points`, `previousPoints`, `source`, `capturedAt` |
| `consent.granted` | `GrantConsent` | consent | `providerId`, `expiresAt` |
| `consent.revoked` | `RevokeConsent` (one per grant revoked) | consent | `providerId` |
| `observation.held` | `SubmitObservation` (implausible reading) | observation | `accountId`, `providerId`, `points`, `previousPoints`, `reviewExpiresAt` |
| `observation.confirmed` | `ResolveObservationReview.confirm` | observation | `accountId`, `providerId`, `points`, `previousPoints` |
| `observation.rejected` | `ResolveObservationReview.reject` | observation | `accountId`, `providerId`, `points`, `previousPoints` |
| `token.issued` | `IssueAccessToken` | token | `scopes[]`, `expiresAt` |
| `token.revoked` | `RevokeAccessToken` | token | (empty) |
| `goal.created` | `CreateTripGoal` | goal | `targetPoints` |
| `goal.updated` | `UpdateTripGoal` | goal | `changed[]` |
| `goal.deleted` | `DeleteTripGoal` | goal | (empty) |
| `watch.triggered` | `CheckAwardWatches` (a watch fired) | watch | `bestRealizedCpp`, `minCentsPerPoint` |
| `transfer_bonus.recorded` | `RecordTransferBonus` | transfer bonus | `fromProviderId`, `toProviderId`, `multiplierPermille`, `startsAt`, `endsAt`, `source` (no URL, no reporter id in the payload; `userId` is the reporter or `system`) |

Notes: an agent reading that is recorded emits `balance.recorded` with
`source: "agent"` (no separate "observation recorded" event); an `unchanged`
reading emits nothing. A re-grant replaces the previous consent silently (the
replaced grant gets no `consent.revoked`). Import/seed flows emit through the
link/record use cases they call.

## How events are written (atomic)

`buildDrizzleRepositories(db)` returns repositories plus `eventing`:

- `UnitOfWork.run(work)` opens one Postgres transaction. All repository calls
  and `EventPublisher.publish` made inside it, including nested use cases,
  join that transaction. This works without changing any repository: they are
  built on a proxy of the Drizzle handle that redirects to the ambient
  transaction (AsyncLocalStorage) while `run` is active. Nested
  `db.transaction` calls (e.g. consent `replaceActive`) become savepoints.
- Every emitting use case does its writes **and** `publish` inside `run`, so a
  failure rolls back state, `activity_event` rows and outbox rows together.
  This covers all emitting flows, in particular balance recording, consent
  grant/revoke, observation hold/confirm/reject and account link/unlink.
- Hosts that build use cases without `eventing` (unit tests, ad-hoc scripts)
  get a no-op: events are dropped and behaviour is identical to before.

## Delivery semantics

- **At-least-once.** A handler can run more than once for the same event
  (crash after the side effect but before `processed_at`, lease expiry while a
  handler is slow, retry after another handler of the same event failed).
  **Handlers must be idempotent**; dedupe on `event.id`.
- **No ordering guarantee**, not even per aggregate: batches are claimed oldest
  first, but retries, backoff and concurrent workers reorder delivery. Handlers
  that care must use `occurredAt`/state, not arrival order.
- **Claiming is exclusive.** `claim` is one short `UPDATE ... WHERE id IN
  (SELECT ... FOR UPDATE SKIP LOCKED)` that increments `attempts` and pushes
  `available_at` out by a lease (default 60s). Concurrent workers never
  receive the same row while its lease is live, and no transaction stays open
  while handlers run. If a worker dies, the row reappears when the lease lapses.
- **Retry.** On handler failure the row gets `available_at = now + base * 2^(attempts-1)`
  (base 5s, cap 1h) and `last_error`.
- **Outcome ownership.** Claim returns the attempt number and exact lease deadline.
  Processing, retry and dead-letter writes require both values to match the current
  nonterminal row. A late worker cannot shorten a newer lease, finalize its claim
  or overwrite a terminal outcome. Rejected writes contribute no processed/retry/
  dead-letter count or hook. This fences bookkeeping; it does not undo a handler's
  external side effect or replace idempotency.
- **Dead letter.** After `OUTBOX_MAX_ATTEMPTS` (default 8) the row is parked
  with `dead_lettered_at` and its `last_error`, and is never claimed again. Rows
  that exhaust attempts by crashing are parked on the next run. Parked rows stay
  in the table for inspection; requeue manually by clearing `dead_lettered_at`
  and resetting `attempts`/`available_at`. `OutboxProcessor` takes an
  `onDeadLetter` callback (and `onBatch`) as the metrics hook;
  `DrizzleOutboxStore.countDeadLettered()` supports a gauge.
- Events with no registered handler are marked processed.
- Processed rows are removed by the bounded [retention job](#retention-purge-job).
  Pending/dead-letter rows retain the separate inspection/replay policy below.

```mermaid
sequenceDiagram
    autonumber
    participant UC as Use case
    participant UoW as UnitOfWork (1 transaction)
    participant DB as Postgres
    participant W as Worker "outbox" job
    participant H as Handlers

    UC->>UoW: run(work)
    UoW->>DB: BEGIN
    UC->>DB: state change (+ activity_event)
    UC->>DB: INSERT domain_event_outbox
    UoW->>DB: COMMIT (all or nothing)

    loop every WORKER_OUTBOX_INTERVAL_SECONDS
        W->>DB: UPDATE ... SET attempts+1, available_at=now+lease<br/>WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
        DB-->>W: claimed batch
        W->>H: dispatch by type ("*" + type handlers)
        alt all handlers ok
            W->>DB: processed_at = now
        else a handler throws
            W->>DB: available_at = now + backoff, last_error
            Note over W,DB: after N attempts: dead_lettered_at set
        end
    end
```

## Worker

`apps/worker`: job `outbox` (one-shot drain) and an `outbox` task in `loop`
(every `WORKER_OUTBOX_INTERVAL_SECONDS`, default 10). Tuning:
`OUTBOX_BATCH_SIZE` (25), `OUTBOX_MAX_ATTEMPTS` (8). Run as many workers as you
like.

Handlers shipped (`packages/core/src/application/events/handlers.ts`, wired in
`apps/worker/src/jobs/outbox.ts`):

- **log** (`*`): one JSON line per event with ids/type/version/correlation id.
  The payload is deliberately not logged.
- **notify-observation-held** (`observation.held`): sends a short message to the
  configured Slack/Discord `Notifier` (only registered when one is configured).
  The Notifier port has no idempotency key, so a retry can post twice.

Add a handler: implement `EventHandler`, `registry.on("balance.recorded", h)`
in `buildEventHandlers`.

## Retention (`purge` job)

Nothing else deletes outbox rows, so the worker `purge` job (one-shot, and a
`purge` task in `loop` every `WORKER_PURGE_INTERVAL_SECONDS`, default 3600)
removes data that is only useful for a limited time, in bounded batches:

| Table | Deleted when | Env |
| --- | --- | --- |
| `domain_event_outbox` | `processed_at` older than `OUTBOX_RETENTION_DAYS` (default 14) | |
| `activity_event` | `occurred_at` older than `ACTIVITY_RETENTION_DAYS` (default 365) | |
| `access_token` | revoked, or expired, more than 90 days ago | fixed |
| `consent_grant` | revoked, or expired, more than 365 days ago | fixed |

**Kept on purpose:** dead-lettered outbox rows (kept for inspection and replay;
they never have `processed_at` set), `balance_snapshot` (the history is the
product; see [performance.md](./performance.md) for the partitioning plan) and
`agent_observation` (the audit trail of agent write-backs). The purge code has
no statement that touches those tables.

Each batch is `DELETE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP
LOCKED)`: bounded work per statement, and several workers can purge at once
without deleting a row twice or waiting on each other. `PURGE_BATCH_SIZE`
(1000) is the rows per statement; `PURGE_MAX_ROWS_PER_RUN` (50000) caps one
run per table (the rest waits for the next run, and the log line says
`capped: true`). One failing table does not stop the others; the job exits
non-zero afterwards.

Each run logs one JSON line:

```json
{"level":"info","msg":"retention_purge","deleted":1234,"durationMs":182.4,
 "targets":{"outbox":{"deleted":1000,"batches":2,"capped":false,"cutoff":"..."},
            "activity":{...},"access_tokens":{...},"consents":{...}}}
```

The age scans are index-served by `domain_event_outbox_processed_idx` and
`activity_event_occurred_idx` (migration `0015_perf_indexes`).

## Schema

Migration `0015_perf_indexes` replaces the outbox polling index with
`domain_event_outbox_claim_idx` on `(available_at, occurred_at, id)` (same
partial predicate, matches the claim query's full `ORDER BY`) and adds the
partial `domain_event_outbox_processed_idx` (retention).

Migration `0014_transfer_bonus` adds the `transfer_bonus` table (see [optimizer.md](./optimizer.md)); `transfer_bonus.recorded` events are written in the same transaction as the row.

Migration `0013_domain_event_outbox`: `domain_event_outbox(id, type, version,
user_id, aggregate_id, payload jsonb, occurred_at, correlation_id, attempts,
available_at, processed_at, dead_lettered_at, last_error)`, a partial polling
index (since 0015: `(available_at, occurred_at, id)`) `WHERE processed_at IS NULL AND
dead_lettered_at IS NULL`, and RLS enabled with no policies (same posture as
0009/0011).
