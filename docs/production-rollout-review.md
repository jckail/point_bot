# Independent production rollout review

Status: source review of the rollout changes following `6b424f6`, on 2026-10-02.
This reviewer changed only this document and ran no tests, AWS operations,
installations or git commands. Root owns aggregate verification and deployment;
successful deployment or final-source CI is not claimed here. Review requirements
come from [production-rollout-plan.md](production-rollout-plan.md).

Shared Graphify has no relevant PointUp code coverage. Current helper, workflow,
CDK and migration source were inspected directly, including the installed CDK
toolkit's template-publication behavior. Findings were sent to implementation
owners before their fixes; the resolved items below describe subsequently
inspected source, not the earlier unsafe versions.

## Sequencing and artifact findings resolved in source

| Finding | Reviewed correction and acceptance boundary |
| --- | --- |
| Deployment activated hosts before migration. | The production workflow retains the reusable verification gate and delegates deployment to the bounded rollout helper. Existing upgrades publish candidates, validate the existing stack, run the exact candidate migration task and require journal attestation before active CDK deployment. A failed gate has no active-deploy fallback. |
| Migration used a digest, while services/schedules used image tags. | Every candidate Docker image is resolved through ECR; every ECS container in the candidate template must match one published asset and is replaced with its `@sha256` URI. The release record includes the image set and the template checksum is rechecked after migration. |
| Local template edits did not update the published template. | Installed CDK `makeBodyParameter` prefers `stackTemplateAssetObjectUrl` over local bytes. Publishing the original manifest and only patching the local template therefore left CloudFormation pointed at the original tag-based template. The helper now rehashes the pretty-JSON pinned template, changes its file-asset identity/S3 object key and stack template URL, and republishes after pinning. It preserves the real file-publishing role. This avoids both stale-template reuse and an assumed direct-S3-upload permission. |
| First-create absence checks could race with another creation. | The helper prepares a unique bootstrap change set without execution. It requires the exact account/region change-set ARN, matching stack ID in `REVIEW_IN_PROGRESS`, and only `Add` changes for the exact inactive logical IDs. It executes that ARN and waits for the same stack's `CREATE_COMPLETE`. A newly existing active stack cannot pass as an inactive update. No undocumented `ChangeSetType` response field is assumed. |
| First creation immediately activated generated application secrets. | First creation always stops after inactive bootstrap and verified migration. A subsequent protected manual dispatch must explicitly attest `bootstrap_ready` before an existing inactive stack can activate. The build key must have production Clerk format before publication; that format check does not establish that the key or runtime secrets are genuine. |
| Existing-stack resource preservation was not checked. | The helper reads the deployed template and rejects removed/type-changed resource IDs, changed protected database/network/cluster properties, and changed task-role identity/trust. Unexplained feature removal requires a separate reviewed infrastructure rollout. Active/inactive bootstrap templates must have the same IDs and image asset set. |
| Historical journal drift was discovered after pending SQL. | The worker now checks the existing journal against the exact candidate prefix under the migration advisory lock **before** running SQL. It then requires full count/hash/timestamp equality, rereads candidate files and emits the matching safe attestation while still locked. Dirty prefix rows cannot authorize pending DDL first. |
| Journal equality did not establish physical readiness. | The worker now checks the candidate's table/column and named CHECK presence, selected ownership FKs, enabled ownership trigger and RLS on every managed table before attestation. The helper requires `schemaVerified: true` in the matching task log. This bounded contract accepts legacy NOT VALID constraints; it does not compare column types, constraint definitions, indexes or every FK. |
| Failed tasks lost their release evidence. | A nonsecret progress receipt is saved after synthesis, bootstrap preparation, registration and launch, before waits. It retains task/definition and private log references. A wait failure attempts to stop the one-off task and blocks promotion. The workflow uploads the receipt even when a later gate fails. |

Sources: [workflow](../.github/workflows/deploy.yml),
[helper and manifest handling](../scripts/deployment/rollout.mjs),
[offline helper cases](../scripts/deployment/rollout.test.mjs),
[migration lock/attestation](../packages/core/src/infrastructure/db/migrations.ts),
[worker migration job](../apps/worker/src/jobs/migrate.ts).

The helper reuses the active candidate assembly after migration; it does not
resynthesize an upgrade with different context. First creation necessarily uses
a separate inactive assembly, but validates matching assets and resource IDs
before creating anything. The recorded checksum is a template checksum, not a
cryptographic digest of every cloud-assembly file or a verified build provenance
signature. Keep the runner/assembly under one release owner and retain the
release record; do not describe that checksum as broader provenance.

## CDK, TLS and IAM review

The inactive mode retains the existing `TemplateApp` construct hierarchy. CDK's
service pattern rejected a zero desired-count constructor value in root's initial
check. The correction keeps the original pattern construction and sets zero on
its existing, type-checked `CfnService` for web and enabled bot/MCP workloads.
The existing web scalable target has min/max zero and all scaling suspended;
all four existing worker rules are disabled. These are final-template changes,
not conditional omission of services or schedules. Root's final synth assertions
remain the verification authority.

Web requires an approved certificate/domain configuration, HTTPS listener and
HTTP redirect; canonical `APP_URL` is the configured HTTPS origin. Explicit
certificate account/region mismatches are rejected before candidate publication
when concrete CDK environment is available. SIWC callback origin must agree.
Public MCP uses an HTTPS upstream, defaulting to the canonical origin; it cannot
fall back to the cleartext web ALB. DNS/certificate ownership and live routing
remain external facts. Bot follows its separately configured feature/TLS policy.

`Migrate` contains only the five database secret fields and required nonsecret
settings. Out-of-band candidate registration retains the real task family,
execution/task roles, Fargate sizing, logging and supported architecture, and
rejects unsupported container shapes. It uses the published worker digest,
`migrate` command and expected manifest hash. Runtime secret metadata must agree
with the stack database secret; subnet/SG/cluster ownership is checked.

The OIDC trust now targets the repository's protected production environment.
Source IAM adds the helper's discovery, change-set, snapshot, task registration,
asset inspection and private-log permissions, with purpose tags on registration
and bounded stack/task/role scopes. An initial policy covered only RDS-managed
`rds!db-*` secrets, but this stack creates a CDK-generated database secret; the
metadata policy now includes the `TemplateApp*` secret lineage. This does not
grant secret-value reads to the deployment helper.

OIDC bootstrapping is a separate explicit deployment mode, so creating/updating
that role does not require application TLS context or deploy `TemplateApp`.
An existing role must be updated through the authorized bootstrap path before
the new workflow can use its permissions. Source assertions cannot prove live
policy authorization, SCP/session restrictions or existing resource names.

Sources: [stack](../infra/lib/app-stack.ts),
[strict rollout configuration](../infra/lib/rollout-config.ts),
[entry point](../infra/bin/app.ts),
[OIDC policies](../infra/lib/github-oidc-stack.ts),
[configuration cases](../infra/test/rollout-config.test.ts),
[active/inactive template cases](../infra/test/rollout-stack.test.ts).

## Verification evidence and remaining production requirements

Implementation owners reported 29 passing offline helper cases. Root reported
25 earlier infrastructure cases and eight initial real PostgreSQL attestation
cases passing. This reviewer did not execute them. Root also passed final focused IAM tests (2) and infrastructure types, plus
14 real PostgreSQL cases including bounded physical-schema drift. A final RLS
case and final-source CI/synth remain pending; root must record
the final aggregate evidence after all changes settle. Fresh final-source CI is
required; earlier release CI does not verify this rollout source. AWS credentials
remain unavailable.

Acceptance coverage now has source cases for malformed task launch/completion,
digest/attestation mismatch, missing configuration, inactive promotion authority,
resource deletion/protected-property changes, bootstrap races and realistic
template file-asset publication. Real PostgreSQL attestation cases include dirty
hash/timestamp prefixes with pending DDL, valid-prefix application while the
session lock is held, and manifest mismatch without schema mutation. Root owns
their actual fixture execution and counts.

No unresolved source blocker remains identified in the reviewed sequencing,
digest publication and prefix-check paths after the corrections above. The
following are still real release requirements, not evidence of a deployed defect:

- Establish valid AWS/OIDC access, actual stack/account/region ownership and
  protected production environment controls. The previously expired local AWS
  session and missing deployment secrets are not repaired by source changes.
- Inspect the real journal **and physical schema** before adopting this lineage.
  The automatic bounded readiness check detects missing required columns and
  named constraints/triggers; it cannot establish equivalent types, constraint
  definitions, indexes or valid historic data. Preserve migration 0019/0020
  legacy boundaries and named NOT VALID constraints; do not stamp an unjournaled
  database or infer clean legacy data.
- For existing databases, supply the approved completed encrypted snapshot for
  the actual database. The helper checks identity/resource ID and a completion
  timestamp within 24 hours. That establishes snapshot metadata, not a tested
  restore, later-write recovery or old-code compatibility. Restore rehearsal
  and an operator-approved maintenance/write-drain plan remain necessary.
- Populate genuine Clerk and enabled-feature secrets before protected inactive
  promotion. `bootstrap_ready` is an operator attestation, not automatic secret
  validation. Verify public DNS, ACM coverage, canonical origin and exact SIWC
  callback routing; keep unapproved linking/providers disabled.
- Inspect the deployed revisions/digests, service stability, authenticated
  read-only smoke and bounded failure metrics after activation. CloudFormation
  rollback does not roll back the database. New candidate task-definition
  revisions are retained; establish bounded cleanup after diagnosis without
  deregistering a revision still in use.

The original live SDK/exporter/Chrome/OAuth/provider and broader data-audit scope
remains in [release-backlog.md](release-backlog.md). This review is not permission
to bypass production adoption, restore or hosting gates.
