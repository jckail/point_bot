# Local frontend audit — 2026-10-02

PR #48 is merged and verified, from source `4af48bb20499958b0a071f82c1cd6cbce46767ae`
at master `0864a1978603caa18ad8d01fb3fe0f6f6820f38b`; source, prospective and
actual master share tree `3b7ea1a03578994f286046e28f3c325f1eecc899`.
All six [candidate CI 37063543492](https://github.com/jckail/point_bot/actions/runs/37063543492)
jobs, [candidate CodeQL 37063543554](https://github.com/jckail/point_bot/actions/runs/37063543554),
Bugbot, [master Deploy 37064115281](https://github.com/jckail/point_bot/actions/runs/37064115281)
and [master CodeQL 37064114784](https://github.com/jckail/point_bot/actions/runs/37064114784)
passed, with 1,822 workspace tests plus one paid live skip, including 41 popup and
12 actual PostgreSQL retention cases. AWS deployment was skipped for missing
role configuration. These are committed-source release checks; the actual local
application browser matrix below remains unexecuted.

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

## Custom valuation editing iteration

Branch `codex/pointup-valuation-ui-20261002` adds the missing account-detail
custom valuation editor. Save and Reset to catalog are explicit actions in one
pending-aware form. The server derives the program from the session-owned active
account and uses the existing Set/Delete valuation use cases. Blank Save is invalid;
Reset ignores the numeric draft and bypasses its browser validation. Values remain
per owner/program, in US cents per point, normalized to three decimals by core.
Input labels, explanatory units, catalog/current provenance and bounded live
feedback are present. Refreshed authoritative rates key the input while retaining
form feedback; neither point balances nor issuer terms change.

Independent source review approved four source files. The initial test proposal's
unreachable duplicate owner/program fixture was corrected before execution.
**25 new actual-core action cases pass**, plus 11 share controller/core controls and
three read-cache controls (**39 focused tests total**). They cover owned provider
selection despite forged fields, normalized persistence/read amounts, accepted
bounds, explicit Reset preserving another owner's override, absent overrides,
blank/tiny/invalid inputs, missing intent/account/session and foreign/deleted
accounts without writes, and infrastructure failures without success refresh.
Web typecheck including the new tests, five-file lint and whitespace checks pass.
TypeScript and ESLint LSP diagnostics for the new form are empty. These are
synthetic core/controller tests, not authenticated HTTP/database/native UI proof.
No meaningful baseline red result is claimed for a previously absent action.

Command: `npm exec --workspace=@pointup/web -- vitest run src/app/account-valuation-actions.test.ts src/app/revoke-share-actions.test.ts src/app/dashboard/share-controls.test.ts src/server/read-cache.test.ts --maxWorkers=2`.
Logs: `/tmp/pointup-valuation-ui-tests.log`, `/tmp/pointup-valuation-ui-final-types.log`,
`/tmp/pointup-valuation-ui-lint.log`, `/tmp/pointup-valuation-ui-test-lint.log`.
Release gates for this new iteration are pending.

Native acceptance remains pending: keyboard Save intent; both buttons disabled
while pending; invalid/blank draft Reset; normalized rate and estimated amount
readback; same-normalized-rate Save and already-catalog Reset with unchanged input
key; feedback retained across refresh; narrow layout and screen-reader field/status
names. The full application matrix below is still unexecuted. Later fresh queue
reads remained occupied; no further caller, database, server or browser was started.

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
| Card and valuation | Explicit Chase selection/clear, advice refresh, save/reset, keyboard intent, invalid-draft Reset, normalized and unchanged-rate readback | Not executed |
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
