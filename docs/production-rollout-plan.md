# Production rollout: migrations before candidate activation

Status: implemented candidate in the integration branch, pending exact committed-source local qualification and actual production-target verification. This document describes source behavior, not a production deployment. Root owns release operations and aggregate checks; agents own bounded helper, infrastructure, migration and review changes. Independent findings and remaining limits are recorded in [production rollout review](production-rollout-review.md).

The current source has passed merged-master release verification through PR #31,
but AWS activation was skipped for missing role configuration. A fresh public
homepage GET on 2026-10-02 returned HTTP 200 HTML without Next.js asset markers.
That response establishes public reachability, not adoption of this Next.js source,
its hosting account, database lineage or a compatible rollout target. Establish
the actual serving stack and data ownership during the environment inventory below.

Jordan's execution policy, effective 2026-10-02 16:19 Pacific, requires all build, test, CI-equivalent and release qualification to run locally on GamingRig through the existing sole verification owner and shared foreground gate. Do not dispatch, retry or watch hosted Actions for qualification. The [workflow](../.github/workflows/deploy.yml) is retained source reference for commands and configuration; its historical hosted execution path is not the current release route. Authorized pushes and merges must use the supported skip mechanism after inspecting current triggers and branch controls. Skipped required checks are not passes; any unavoidable protected-branch remote-check restriction remains an explicit blocker.

The local release route reuses the actual [helper](../scripts/deployment/rollout.mjs), [CDK configuration](../infra/lib/rollout-config.ts) and [migration gate](../packages/core/src/infrastructure/db/migrations.ts). First qualify the exact commit/tree and preserve local command, log, source-fingerprint and isolated-fixture receipts. The helper's `VERIFY_ONLY=true` returns before rollout; it does not execute reusable CI or qualify the candidate. A future authorized local invocation must supply verified target configuration and real credentials through the approved operator path. Its `GITHUB_SHA` field is receipt metadata and must contain the exact qualified commit; it does not require an Actions run or prove qualification.

Local qualification does not authorize guessing a production target. Fresh local STS authentication succeeded and a read-only `TemplateApp` lookup explicitly found no stack in `us-east-1`; this does not establish account mapping, data lineage or an adoption path for the existing legacy environment. Local activation remains unexecuted. Before it runs, review a bounded local driver and its interruption/recovery behavior around asset publication, migration tasks and change sets, retaining exact nonsecret progress references. A twenty-minute shared check timeout is not proof that cloud operations stopped: reconcile the actual registered task/change-set/stack state before any retry. Never substitute hosted Actions when local prerequisites are unresolved.

## Existing stack

1. Discover the actual AWS account/region and stable `TemplateApp` stack. Require real production Clerk build configuration and the approved web certificate/domain; optional assistant, ChatGPT linking, MCP and provider configurations remain explicit. Synthesize one active candidate assembly using those inputs.
2. Publish candidate Docker assets with pinned `cdk-assets` 4.7.3, resolve their ECR digests and pin every ECS container image. Publish the corresponding patched template asset. Use that same assembly for later deployment; its template checksum must remain unchanged after migration.
3. Inspect the deployed template before any stack update. Reject removed/type-changed resource identities, changes to protected database/network/cluster properties, and task-role identity/trust changes. Preserve existing optional features in the deployment configuration; omitted features cannot silently remove resources.
4. Resolve the real migration cluster, task definition, private subnets/security group, database and secret from stack outputs/resources. Validate account/region, network ownership, Fargate shape, existing task roles and DB JSON selectors. Clone the existing migration task family with the candidate worker digest, command `migrate`, DB-only secrets and expected migration-manifest SHA-256. Do not guess resource ARNs or read secret values into workflow output.
5. Before an existing-database migration, require `APPROVED_DATABASE_SNAPSHOT_ARN`: an available encrypted snapshot of the exact live DB identifier and resource ID, completed within the preceding 24 hours. This is a backup metadata gate, not a restore rehearsal or automatic snapshot creation.
6. Run the exact registered task ARN without public IP. Preserve task/log references in a nonsecret progress receipt. Launch failures, timeout, unexpected task/container identity, nonzero exit, wrong image digest or missing journal attestation block activation. A failed wait attempts to stop only the launched task; inspect its actual status before retrying.
7. The worker verifies baked SQL/journal hashes against the expected candidate, checks the existing managed journal is an exact prefix **before** applying pending SQL, then verifies full journal equality, required tables/columns/named checks, selected ownership FKs, enabled ownership trigger and RLS on every managed table, and emits a flushed safe attestation while holding the session advisory lock. An absent/empty journal with existing PointUp tables is refused. Ordinary local/adoption entry points without candidate mode retain their existing behavior; production history is never manufactured.
8. Only after the task and attestation gates succeed, deploy the pinned active assembly and await CloudFormation completion. Authenticated smoke, actual deployed digests, provider access and production metrics still require separate live verification.

## First creation and activation

First creation needs database/network resources before it can migrate. The helper confirms absence, synthesizes the same resource identities in inactive mode, and prepares a change set without execution. Execution requires the exact prepared change-set/stack ARNs, a `REVIEW_IN_PROGRESS` creation stub and only `Add` actions for precisely the candidate resource IDs. A concurrent existing-stack creation cannot authorize an inactive update.

Inactive bootstrap preserves all constructs: web/bot/MCP desired counts are zero, autoscaling min/max are zero with scaling suspended, and all four worker schedules are disabled. The migration container gets only database secrets. Web TLS and canonical HTTPS origin are mandatory; MCP defaults to that encrypted origin.

First creation always stays inactive after verified migration. Populate genuine application secrets through the authorized operator path and verify certificate/DNS ownership. A later authorized local operator invocation with `BOOTSTRAP_READY=true` attests genuine readiness for an existing inactive bootstrap; it still requires backup and fresh candidate migration gates. This value must come from verified secrets/TLS/DNS readiness, not a synthetic fixture or an automatic push. A push does not provide this attestation. Never use fake keys, dev authentication or local bootstrap-token minting in production.

## Identity and permission preservation

Keep `TemplateApp`, VPC, RDS, cluster, services, images, task definitions, logs, security groups, secrets and schedule construct paths. CDK assertions compare active/inactive logical IDs. Resource removal or protected-property drift requires a separate reviewed infrastructure rollout.

The GitHub role trusts the exact repository's `environment:production` subject and STS audience. It assumes real CDK bootstrap publishing/deployment roles and has explicit bounded resource inspection, purpose-tagged candidate-task registration, migration RunTask/PassRole/log inspection, backup metadata and bootstrap change-set execution permissions. Tests do not establish that the deployed IAM role or GitHub environment protections match this source.

## Operational limits and recovery

The migration advisory lock serializes migration hosts; it does not stop application writes. Review pending SQL against the running release and actual table sizes. Migration 0018 includes archival locking; 0019/0020 retain staged `NOT VALID` constraints. Historical rows still need operator inspection, repair and validation. Establish a maintenance window and write/drain policy for incompatible changes rather than assuming additive migrations are zero downtime.

Keep the approved snapshot, prior images/task revisions and deployed template. Test restoration into a separate instance before relying on recovery. Migration failure blocks candidate activation; inspect journal/table state before a retry and never stamp history or automatically run down migrations. Application rollback after a successful migration requires old-code compatibility with the new schema. CloudFormation rollback does not restore PostgreSQL; a snapshot restore can lose later writes and requires an explicit recovery decision.

External gates remain: verified production account/stack ownership and approved scoped local deployment access, independent release review and applicable protection controls, real application secrets, TLS/DNS, approved backup/restore access and live health/authenticated smoke. Successful local authentication alone does not prove these prerequisites; missing GitHub deployment-role configuration alone does not prevent a properly authorized local route. Local AWS STS responded on October 2. Read-only us-east-1 inventory found the existing legacy PointUp Elastic Beanstalk environment, not a verified managed ECS deployment target. Fresh GitHub secrets and environment lists remain empty. No production deployment is claimed.

## Verification checkpoint

Root installed the pinned asset publisher through serialized `npm ci`; actual version is 4.7.3. Infrastructure types and 25 CDK/configuration tests passed before the final IAM/helper refinements. Full workspace lint/types passed. Eight isolated PostgreSQL tests passed, including hash/timestamp drift before DDL, fresh manifests, exact post-migration journal/lock attestation, legacy tables without history, and unrelated-table handling. Final helper, infrastructure and committed-head aggregate evidence is recorded in [integration status](integration-status.md) and [release backlog](release-backlog.md); earlier runtime CI evidence must not be reused as proof of these new deployment changes.

Graphify was queried but has no PointUp code coverage; live source is authoritative. Agent Hub has no configured memory scope for this worktree, so curated repository notes provide continuity. These limitations do not justify replacing the shared graph or uploading private transcripts.

## Card selection rollout (0021)

Apply `0021_card_product` before deploying new account writers. It adds a nullable
`varchar(64)` selection with a validated provider/product compatibility CHECK;
existing accounts remain unknown without inferred backfill. Candidate readiness
requires the column, its type/nullability and the CHECK alongside the complete
managed journal. It is a bounded physical contract, not a full schema-equivalence
proof. Confirm the rule on actual issuer accounts and retire older web/worker/MCP
versions that calculate unconditional Chase→Hyatt yields. Unknown or unverified
cards now exclude this route; communicate the account Details selection path.
