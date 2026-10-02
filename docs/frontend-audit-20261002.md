# Local frontend audit — 2026-10-02

Current candidate: `codex/pointup-local-frontend-audit-20261002`, based on verified
PR #47 master `6c1735167` (source `da01cb2949`, equal candidate/prospective/master
tree `e37c26dd`). All six [candidate CI 37060371411](https://github.com/jckail/point_bot/actions/runs/37060371411)
jobs, [candidate CodeQL 37060371609](https://github.com/jckail/point_bot/actions/runs/37060371609),
[master Deploy 37060831081](https://github.com/jckail/point_bot/actions/runs/37060831081)
and [master CodeQL 37060832832](https://github.com/jckail/point_bot/actions/runs/37060832832)
passed, with 1,811 workspace tests and one paid live skip. AWS deployment was
skipped for missing role configuration. This is historical committed-source
verification; the new frontend candidate has not passed its release gates.

## Applied source fixes and focused evidence

Nine reviewed source/test files are applied:

- Dashboard preserves share management when an owner-visible active link exists
  after the last program is unlinked. It does not implicitly revoke links or change
  creation policy.
- Per-row Revoke uses existing ActionResult, useActionState, FormFeedback and
  SubmitButton. Session/domain failures produce bounded feedback; owner checks
  remain in core, infrastructure failures propagate, and only success refreshes.
- Membership-number and manual-balance inputs receive explicit labels with
  React-generated IDs. The UTC date label remains associated with its input.
- Account detail displays the effective custom-or-catalog cents-per-point rate
  alongside the value calculated from that rate, with valuation provenance.

Original share/controller tests produced six failures and five passes out of 11.
A temporary legacy single-argument action-call adapter qualifies the original
Revoke red proof; it is absent from the final tests. Fixed source passes all 11,
plus six Restore and eight Goal Delete controls: **25 focused tests passed**.
The new cases invoke actual async dashboard controllers, actual core use cases,
existing in-memory repositories and the actual public resolver. They cover active
share visibility with no accounts; absent/revoked/expired/foreign controls; session,
owner and missing-ID failures without writes; and successful revocation denying
public-token resolution. They do not prove a real authenticated HTTP route or
production database concurrency. Web typecheck, nine-file lint and whitespace
checks passed. Native accessible names and effective-rate rendering remain pending.

Changed paths: `apps/web/src/app/dashboard/page.tsx`, `apps/web/src/app/actions.ts`,
`apps/web/src/components/share-portfolio-section.tsx`,
`apps/web/src/components/revoke-share-form.tsx`,
`apps/web/src/app/revoke-share-actions.test.ts`,
`apps/web/src/app/dashboard/share-controls.test.ts`,
`apps/web/src/components/manual-balance-form.tsx`,
`apps/web/src/components/membership-number-form.tsx`, and
`apps/web/src/app/dashboard/accounts/[id]/page.tsx`.

## Actual application browser coverage

**NOT EXECUTED.** The first coordinated `agent-heavy-check` launch exited 75
before any database, server or browser work. Log:
`/tmp/pointup-local-frontend-root-20261002.log`. A subsequent supervisor capacity
update reported the lock free, but the fresh local precheck found it busy again.
A shell-sequence error nevertheless queued an owned caller; root stopped only that
caller immediately (exit 130), before database/server/browser startup. No check
ran or gate was bypassed. Further application execution requires changed admission
evidence; neither attempt proves native application behavior.
The matrix is a plan, not acceptance evidence. Root alone owns verification,
server/browser lifecycle and Git operations.

| Feature | Planned local application checks | Current browser evidence |
| --- | --- | --- |
| Landing and navigation | Header/footer destinations, account/agents/settings navigation, section anchors, skip link, keyboard focus | Not executed |
| Empty portfolio and demo | Empty guidance, available provider selection, sample-data action and repeated-action feedback | Not executed |
| Link and programs | Required membership, duplicate/provider errors, filters/search/tags/reset, cards and pinning | Not executed |
| Account detail | Current balance/history/chart, explicit field names, UTC date, invalid balance/date feedback, membership/notes/tags changes | Not executed |
| Card and valuation | Explicit Chase selection/clear, advice refresh, custom versus catalog rate consistency | Not executed |
| Sync controls | Unavailable/configured/demo labels and pending/failure handling; never describe simulated data as live | Not executed |
| Unlink and Restore | Unlink last program, retained history, Restore pending/result, expired/missing/session controls | Not executed |
| Trip goals | Create validation, progress, row-specific Remove pending/result, repeated/missing ownership controls | Not executed |
| Import and export | CSV/JSON downloads, multiline CSV round trip, malformed import error without partial state | Not executed |
| Sharing | Create link, preserve listing after last unlink, per-row Revoke feedback, public token rejection after revocation | Not executed |
| Opportunities and expiry | Estimates/warnings, empty opportunities, expiry dates/calendar and honest availability caveats | Not executed |
| Agent access | Scoped token creation/list/revoke, one-time secret handling, consent approval/revoke, review/held observations | Not executed |
| Assistant and proposals | Recovery/draft/uncertain state, read-only versus proposed actions, approve/reject/expiry feedback without mutation replay | Not executed |
| Identity settings | Unconfigured/status/error/retry UI and settings navigation | Not executed; actual Clerk/OpenAI linking requires credentials |
| Responsive accessibility | Narrow layouts, overflow, associated input labels, accessible names, pending controls and live announcements | Not executed |

Most portfolio features can be exercised with explicit local dev authentication
and synthetic local data. Dev auth does not prove Clerk identity, production
owner transitions, live model/provider integration, paid inference or exporter
delivery; those require separately configured credentials and authorized fixtures.
The earlier Restore-only native React fixture used a mocked server action:
functional assertions passed but its wrapper exited 241 after esbuild cleanup
required SIGTERM. It is not this actual-app audit or a green wrapper result.

Production activation, provider/model/identity acceptance, licensing and durable
audit delivery remain open in [release-backlog.md](release-backlog.md). PointUp
remains excluded from shared Graphify; its semantic index is held. This audit
claims live-source inspection, not fresh graph/index coverage.
