# PointUp release backlog

The original full overhaul goal remains active. Preserve PR #14's functionality,
the native PR #15 work and combined PR #16 while completing the frontend/backend/
data audit, genuine identity and assistant integrations, provider/developer access
and production release. iOS remains deferred. Implemented source is summarized in
[integration-status.md](integration-status.md); the priorities below are remaining
work, not a request to remove capabilities or substitute read-only features.

## Immediate release gates

1. Preserve the exact verified release candidate and complete its production gates.
   Current `370130945ff34fa1ac7775984068d837d9e7d4bc` passed all six
   [CI 37000134163](https://github.com/jckail/point_bot/actions/runs/37000134163)
   jobs and [CodeQL 37000134144](https://github.com/jckail/point_bot/actions/runs/37000134144):
   1,302 workspace tests, one paid live skip, 30 rollout/28 infrastructure cases,
   managed 0020/PostgreSQL attestation, all bundles/contracts/HTTP MCP and Docker
   direct/PgBouncer smoke. Root's 130 core, 50 extension and 11 actual PostgreSQL
   focused cases plus lint/types also passed. Earlier verified `977a4d5` evidence is
   retained in [integration status](integration-status.md); these passing gates do
   not establish production activation or live integration behavior.
2. Renew expired AWS authentication; renewal is pending. Configure the authorized
   GitHub deployment role/application secrets and protected production environment.
   The last repository secret inspection found none. Verify actual account/region,
   stack ownership, deployed IAM and certificate/DNS/public HTTPS origin configuration.
3. Inspect actual staging/production journals, tables and data before adopting managed
   history through 0020. Establish an approved recoverable backup and restore rehearsal,
   compatible adoption path and any required write/drain window. No source branch or
   fixture proves deployed lineage. Diagnose migration 0018 lock contention before any
   deliberate retry; its archival lock timeout is 30 seconds.
4. Exercise the implemented migration-first release flow against the real environment:
   immutable images/template, protected existing resources, exact candidate task/manifest,
   pre-SQL journal prefix, locked post-migration attestation and schema readiness, then
   host/schedule activation. First creation must remain inactive; later readiness
   attestation must be genuine. Retain release/task/log references and rollback assets.
   CloudFormation rollback does not restore PostgreSQL. See
   [rollout plan](production-rollout-plan.md) and [review](production-rollout-review.md).
5. Verify hosted readiness, authenticated smoke, Clerk sessions/callbacks, optional MCP
   routing and configured feature secrets before enabling them. Configure alarm
   notification destinations and tune thresholds from real traffic; current alarms
   have no notification actions. Verification-only success does not establish AWS
   deployment or event delivery.

## Historical data, provenance and retention

- Audit historical simulated balances using reviewed deployment/configuration and
  adapter evidence. Old simulation and genuine sync both used source `sync`; that
  value alone is insufficient to identify or delete rows. Preserve recoverable data,
  document unresolved provenance and review any quarantine/repair policy explicitly.
  The new gate prevents future implicit simulation; it does not repair old readings.
- Inspect legacy numeric violations, tenant/provider ownership mismatches and goal
  adoption quarantine against the actual deployed lineage. Repair with reviewed
  evidence, then separately validate staged NOT VALID constraints. Preserve tags,
  ordered goal membership, review IDs/outcomes, unknown historical witnesses,
  `agent` balance source, activity/outbox and account expiry metadata. Continue
  atomicity/RLS and remaining rate/deal/cash boundaries review; do not hide invalid
  history with global clamping. See [numeric integrity](numeric-integrity-plan.md)
  and [observation plan](observation-integration-plan.md).
- Candidate 3701309 stores only generated-reference diagnostics for new outbox
  failures; historical raw exception text remains until a reviewed scrub. Define and
  implement an auditable scrub, finite dead-letter retention/replay window, backup-
  retention policy and any DTO/access review. Existing processed-event retention is
  not proof that pending/dead-letter rows or backups expire. Preserve retry/delivery
  semantics and useful nonsecret correlation; test real retention/replay boundaries.
- Extend durable proposal audit/operations coverage for pending expiry and stale
  execution recovery. The success journal is authoritative; metrics/logs do not prove
  completion. Verify production outbox delivery and observation replay/review recovery
  after deployment, preserving current credential/grant rechecks and original witnesses.

## Live assistant, Chrome and provider acceptance

- Configure an approved OpenAI project key in the web-only secret and choose an
  explicitly available model. Run the ten-case synthetic live evaluation with the
  manual rubric and automated assertions; the paid evaluation is currently skipped.
  Prove inference, opt-in SDK trace export and dashboard/CloudWatch arrival independently.
  Keep default-off tracing, kill switch and private payload handling intact.
- Verify authenticated dashboard/chat/review and unpacked Chrome extension behavior
  with controlled portfolios: cancellation, late proposal persistence, explicit review/
  refresh, popup reopening during inference, account changes, service-worker lifetime,
  frozen capture retries, displayed-ID discard, review-tab reuse, focus and accessibility.
  Source tests and bounded layout checks do not prove browser/provider lifecycle behavior.
- Complete guided capture/extractor coverage for Chase, Amex, Capital One and Bilt.
  Catalog/playbook presence does not establish extraction support or logged-in provider
  behavior. Validate actual balances/award space; do not infer them from demo adapters.
- Pursue provider APIs/developer partnerships where available. Verify configured
  aggregator access and truthful capabilities; retain consented manual/guided capture
  where no API is available. Review upstream currency/rate and remaining parsing bounds
  against real provider formats without exposing credentials or private response bodies.

## Genuine ChatGPT identity and eligible plan usage

- Validate existing SIWC owner linking with actual client access, canonical callback
  hosting and Clerk credentials. Linking is implemented; independent sign-in is not.
- Implement the standalone design after establishing approved website-client and Clerk
  custom-provider compatibility: subject-only authoritative owner mapping, reverified
  enrollment, immutable issuer/client/subject reconciliation, explicit new-user policy,
  MFA/enterprise/session controls, unlink/logout/revocation and adversarial tests. Do not
  email-auto-link or bypass normal Clerk policy with backend sign-in tickets. See
  [standalone design](chatgpt-standalone-plan.md).
- Assess open-source ChatGPT plan usage separately from website SIWC. Official dynamic
  per-user/workspace registration does not require a partner API key, but PointUp
  licensing/eligibility is unverified. Establish a supported local/self-hosted runtime,
  loopback callback and protected rotating-token storage outside browser storage; MV3
  storage or Chrome identity callbacks are not demonstrated substitutes. A native
  companion is a candidate requiring implementation/security review. Implement the
  compatible inference adapter and required registration/preview parameters before
  claiming plan-funded inference. No provider registration or plan usage is completed.

## Public MCP, plugins and developer onboarding

- Complete the [public MCP auth plan](public-mcp-auth-plan.md) with an established IdP
  compatible with existing Clerk owners. The disabled OAuth JWT adapter is unwired;
  mandatory issuer/resource audience, client, owner and scope verification must remain.
  Establish real resource issuance, client/redirect/PKCE/discovery compatibility and
  revocation behavior; reject opaque tokens until resource binding is proven.
- Wire a separate OAuth principal/backend authorization path without treating OAuth
  as a Clerk session or PAT. Begin with the reviewed read-only seam, preserving existing
  scoped PAT/direct mutation capabilities and browser-only approvals. Do not forward
  MCP-audience credentials to another resource without an authorized delegation design.
- Complete required metadata/tool challenges, public HTTPS hosting, onboarding/consent,
  plugin/Action publishing and live OpenAI client acceptance. Keep approval/rejection
  excluded from the generated Action spec. Offline verifier/tool tests do not establish
  real client authorization or hosted discovery.

## Continued audit and working constraints

Review remaining infrastructure/development dependency advisories and future advisories;
the last observed application production audit was clean. Continue the broader frontend,
backend, data and documentation audit with meaningful bounded regressions and compatible
additive changes. Preserve the full goal and deferred iOS boundary.

Root owns aggregate checks, PostgreSQL and release operations. Expensive checks use the
shared heavy-check gate and one verification owner; no unchanged contention retries or
lock bypass. Preserve stopped root fixtures/data and unrelated processes/worktrees.
Shared Graphify refresh succeeded with 164,478 nodes but PointUp coverage is absent;
query first and inspect current source. Agent Hub's project memory scope is unconfigured,
so curated repository notes carry continuity. This checkpoint claims no production mutation,
merge, live provider/model/exporter call or new browser execution.
