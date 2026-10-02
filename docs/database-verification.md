# PostgreSQL verification

## Current-source CI evidence

At `4303c05`, [GitHub Actions run 36969293365](https://github.com/jckail/point_bot/actions/runs/36969293365) passed **47 actual PostgreSQL tests**: 24 agent/authority/action cases, eight baseline cases and 15 portfolio migration/transaction cases. The reusable workflow provisions separate fresh PostgreSQL 16 services. Agent runs before baseline to exercise legacy SIWC adoption; portfolio runs on its own empty database to stage legacy data before migration 0009.

Portfolio cases verify tenant-qualified membership, canonical tags and legacy projections, snapshot/feed and whole-import rollback, concurrent imports/replacements, migration lock contention and independent concurrent migration clients. This verifies the current source history, not PR #14 schema compatibility or production deployment.

The local portfolio fixture was not rerun after lock contention; it is stopped with its volume preserved. Earlier local verification and cleanup below remain historical.

## Earlier local verification

Verified on 2026-10-01 using the opt-in suite at `packages/core/test/postgres-integration.test.ts`.

A dedicated Docker fixture used cached image `postgis/postgis:16-3.4`, test-only role `pointup_fixture`, database `pointup_integration`, and a randomly assigned port bound to `127.0.0.1`. The fixture name was `pointup-pg-verification-fc3f09bd4e`. Its generated password was stored only in temporary files with mode 0600 and never printed. No project environment file, production credentials, deployment database or existing user container was used.

The current source tests were copied to the Linux validation mirror at `/tmp/pointup-verification`. The tests call the actual Drizzle PostgreSQL migrator for all nine checked-in migrations, including `0008_agents_and_proposals.sql`. SIWC storage is now part of managed core migrations; a separate manual storage-SQL setup is no longer required. The legacy SQL remains exercised as an adoption/idempotence fixture.

## Results

- **8 baseline PostgreSQL integration tests passed** in the final run, including real application repositories and their existing database constraints.
- **Core TypeScript checking passed**, including the new test.
- **8 integration tests were skipped as expected** when `DATABASE_INTEGRATION_URL` was absent; ordinary tests do not initiate database connections.
- The dedicated container and its fixture volume were removed. The temporary credential/config files were removed. An exact-name container check returned no remaining fixture.

The database tests establish:

| Behavior | Evidence |
| --- | --- |
| Existing migrations apply | Actual migration runner populated nine `drizzle.__drizzle_migrations` entries; both SIWC tables exist with RLS enabled. |
| Concurrent provider links have one winner | Two real repository inserts for the same user/provider produced one successful insert and one translated `DUPLICATE_LOYALTY_ACCOUNT` error. |
| Backfills preserve balance chronology | Real `RecordManualBalance` and repository reads retained the later observation as latest and returned history in capture order; expiry stayed unknown. |
| Snapshot referential integrity | An orphan snapshot was rejected, soft deletion retained history, and hard deletion cascaded that account's history. |
| Atomic one-time SIWC consumption | Four concurrent `DELETE ... RETURNING` operations on one transaction yielded exactly one row total; another replay yielded none. |
| Transaction rollback restores the consumed row | A deliberately rolled-back consume left the fixture transaction available for one subsequent consume. |
| Identity ownership is stable | Re-linking the same subject/owner was idempotent; another owner received no row; a second subject for the same issuer/client/user violated the unique constraint. |
| Browser-style role cannot access server-only storage | A separate `NOSUPERUSER NOBYPASSRLS` role received permission denial before grants. Even after explicit SELECT/INSERT/DELETE grants, RLS hid both tables' seeded rows, prevented deletes and rejected insertion; privileged checks confirmed protected rows remained. |

## Reproducing safely

Prepare a new disposable PostgreSQL fixture using the same test-only database/role names and a generated password. Bind its port to loopback only. Provide its URL solely as `DATABASE_INTEGRATION_URL`; the suite deliberately ignores `DATABASE_URL` and rejects non-loopback hosts or any database/user other than `pointup_integration`/`pointup_fixture`.

Run from `packages/core`:

```bash
DATABASE_INTEGRATION_URL='postgresql://pointup_fixture:FIXTURE_PASSWORD@127.0.0.1:FIXTURE_PORT/pointup_integration' \
  node ../../node_modules/vitest/vitest.mjs run test/postgres-integration.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit
```

The URL above contains placeholders, not the verification password. Prefer injecting the generated fixture URL from a private environment/config file so it is not placed in shell history. The fixture owner needs migration/role-creation privileges; the access-control assertions explicitly switch to the nonprivileged role. The suite removes its own UUID-qualified records and temporary role, but intentionally does not drop migration/application tables. Remove only the dedicated fixture container/volume after verification.

## Limits

This suite verifies the actual core repositories and the SQL semantics used by SIWC storage. The SIWC operations are direct parameterized SQL, matching the source operations; the suite does **not** import application `storage.ts`, because that module uses the web environment alias. JSON payloads are explicitly serialized/cast in this combined test client because Drizzle configures the postgres-js serializers; the application's raw storage client is separate.

Passing these tests does not establish HTTP callback validation, ID-token signature/issuer/audience verification, browser cookies, Clerk account linking, PKCE exchange, or a live ChatGPT login. Expiry/state/verifier checks belong to the application callback logic, not the atomic consume SQL tested here. The baseline suite alone does not establish production migration state, deployment-role privileges, database backups, tenant isolation for portfolio tables, transaction support for portfolio imports, or live provider integrations. The current portfolio suite separately verifies import transaction rollback; see current-source CI evidence above. RLS assertions apply to the two server-only SIWC tables; they do not claim that loyalty tables have tenant RLS.

The shared Graphify query still lacked PointUp source coverage, so this work verified the current source directly. Agent Hub context routing for the actual repository returned a generic projects/no-default-child response; no remote memory was used.


## Durable-agent migration and persistence checks

The new `agents.test.ts` unit suite passed **5 tests**. `agents-postgres-integration.test.ts` passed **12 real PostgreSQL tests**, and core TypeScript checking passed after the final repository fixes. Two fresh loopback fixtures distinguished migration adoption from blank initialization: `pointup-agent-pg-adoption-6ab9295c` seeded existing standalone SIWC identity storage before the managed migrator; `pointup-agent-pg-blank-d682d129` started empty and proved all managed tables existed before the legacy idempotence SQL ran. The adoption row survived migration. Final cleanup removed both dedicated containers/volumes and their temporary generated-credential files.

These tests additionally establish that PAT secrets are returned once and only SHA-256 hashes are stored; last-use and revocation persist across separate database client/repository instances; expiry, write scopes, active account consent and canonical account ownership are enforced; concurrent identical observation submissions produce one snapshot, audit record and activity event; changed payloads reject the reused observation ID; tenfold/zero-boundary changes remain held until explicit owner review; repeated concurrent approvals write only one snapshot; rejection writes none; and composite foreign keys reject mismatched account owners/programs even for direct SQL writes. The four new agent/proposal tables also have RLS enabled, and a nonprivileged role with explicit SELECT grants sees no rows.

Core observation persistence locks the token, owned account and consent inside the same transaction as the observation receipt, snapshot and activity write. Capture provenance retains only the exact permitted provider hostname and capture method, with the full canonical input URL represented solely in the payload hash. Source-host validation establishes a permitted claimed origin, not authenticity of a page's balance. Agent scopes do not grant browser-session token management, consent management or review approval; those HTTP/session boundaries are implemented and tested by the web layer separately.

The migration's composite foreign keys depend on unique indexes across owner/program identity. Their creation is explicitly ordered before the foreign keys; the actual PostgreSQL migrator verified that ordering. Both SIWC tables can be adopted from the previous standalone SQL without dropping identities or transaction data. All six server-only agent/proposal/SIWC tables revoke PUBLIC and existing browser-role privileges, have RLS enabled and intentionally define no public policies. Runtime access must use the deliberate trusted server owner/BYPASSRLS role; browser queries use the API rather than direct database grants.


## Persistent assistant action verification

The agent PostgreSQL suite now includes five direct persistent-action regressions and passed **12 total tests** on the fresh disposable fixture `pointup-action-pg-9967ce681e`. Core TypeScript checking passed. These tests use the real `DrizzleAssistantActionRepository`, and owner/expiry/recovery cases also exercise `ManageAssistantActions` with real loyalty repositories and a spied mutation boundary.

- Six simultaneous repository claims of one unexpired pending proposal produce exactly one executing claim. Executing and succeeded proposals cannot be claimed again; the success result remains persisted.
- Duplicate inserts with changed points, expiry, status and result return the existing immutable proposal without overwriting it. A different owner cannot replace the existing row.
- Foreign-owner lookup/list/claim/approval/rejection do not reveal or mutate the proposal. A nonprivileged browser-style role cannot read a seeded action even after receiving SELECT permission.
- At the five-minute execution-lease boundary, an abandoned executing proposal becomes durable `unknown`. Approval and a newly instantiated repository cannot claim or replay it, the balance mutation is never called, and a late success journal cannot overwrite the unknown status.
- At the fifteen-minute proposal-expiry boundary, claiming is denied, a rejection cannot win over expiry, and repeated approval returns expired without invoking the balance mutation.

The dedicated fixture container and volume were removed, the exact-name container check was empty, and generated credential/config files were removed. This verifies persistent claim/lifecycle semantics and core owner checks. Browser-session HTTP enforcement, model tool routing and full interactive approval remain separate web/MCP tests; it does not claim transactional atomicity between action journaling and existing loyalty mutation use cases.


## Authorization expiry during database lock waits

On 2026-10-01, the current `agents-postgres-integration.test.ts` passed **24 real PostgreSQL tests** on dedicated loopback PostGIS 16 fixture `pointup-expiry-pg-bb1ba67902`. The same final run passed all **8 baseline PostgreSQL tests**, for **32 passing database tests**. Core TypeScript checking passed after the final source edits. With `DATABASE_INTEGRATION_URL` absent, all **24 agent database cases skipped** without opening a fixture connection. Its generated credentials remained in private temporary files. After the run, only this owned fixture container and its anonymous volume were removed; the exact-name container check was empty and all generated credential/config files were removed. The suite injects a separate deterministic clock into each fixture's token and observation repositories. The default repository clock is `systemClock`, so existing host constructors remain valid.

The twelve additional regressions use a separate PostgreSQL transaction to hold a real row or table lock. They inspect `pg_stat_activity` and follow `pg_blocking_pids` before advancing the fixture clock or releasing the holder; elapsed sleeps do not establish the authorization race. They verify:

- Authentication that crosses token expiry while waiting for its token row rejects and leaves `last_used_at` unchanged. An unexpired control records the fresh time after the lock releases.
- Ingestion rejects token expiry while waiting for token, account or consent locks, and rejects consent expiry while waiting for consent. No observation receipt, snapshot or activity event remains.
- Token and consent expiry during a blocked snapshot insert rolls back every write, including the snapshot and activity event created after the lock releases.
- Replaying an existing receipt rechecks both grants after waiting for that receipt's lock. An expired grant cannot return the receipt, and the original single snapshot, receipt and activity event remain unchanged.
- A replay queued behind concurrent token or consent revocation rejects after revocation completes. It creates no additional receipt, snapshot or activity event.

Repository authorization uses the later of the request timestamp and a fresh clock reading. Both locked grants are checked after blocking reads, before returning a replay, before writes and again after awaited writes; failure rolls back the transaction. This verifies the core database authorization boundary and concurrency behavior, without extending the earlier HTTP/session or deployment claims.
