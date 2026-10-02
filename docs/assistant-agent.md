# PointUp assistant agent and reviewed actions

The web dashboard and extension share authenticated `POST /api/v1/assistant/chat`. `ASSISTANT_RUNTIME=legacy` preserves PR14's existing provider selection, including Bedrock, the OpenAI-compatible adapter and the heuristic fallback. Set `ASSISTANT_RUNTIME=agents`, a server-only `OPENAI_API_KEY`, and an explicit `ASSISTANT_MODEL` to use the TypeScript OpenAI Agents SDK. PointUp personal access tokens authorize portfolio access; they are not inference credentials.

The route retains PR14's shared authentication, rate limiting, CSRF checks, request telemetry and error mapping. Chat requires `portfolio:read`. Cookie sessions and tokens with `portfolio:write` receive proposal tools; read-only tokens receive only read tools. Legacy chat does not propose changes. No model or token can approve a proposal through a chat tool.

The latest merged Restore feedback release is [PR #45](https://github.com/jckail/point_bot/pull/45)
from source `5b528500842050acc332b960acaaffdfcd0b06b8`, at master
`2517c5648cfdbc156ee68152ec21b9c62c05a834`. Candidate, prospective master and
actual master have the same tree, `1ea69887e79dec51e55b9738ed4cc693e81c21e2`.
All six candidate jobs in [CI 37058268812](https://github.com/jckail/point_bot/actions/runs/37058268812),
[CodeQL 37058268584](https://github.com/jckail/point_bot/actions/runs/37058268584)
and Bugbot passed, with 1,796 workspace tests and one paid live skip. Merged-master
[Deploy 37058846422](https://github.com/jckail/point_bot/actions/runs/37058846422)
and [CodeQL 37058845968](https://github.com/jckail/point_bot/actions/runs/37058845968)
also passed with 1,796 workspace tests and one paid live skip, including 41 popup
and 12 actual PostgreSQL retention cases. AWS deployment was skipped for missing
deployment-role configuration; production activation remains unverified.

The current six-file Goal Remove feedback and initial tool-abort candidate is
applied on `codex/pointup-mutation-feedback-telemetry-20261002`, following hash
verification of both independently approved proposals. Eight actual core/action
Goal Remove cases preserve owner checks, events and success-only refresh while
returning bounded error/session feedback through the existing form components.
A past target date remains removable; no deletion deadline is invented.
Three real installed SDK `tool.invoke` cases cover pre-aborted Error/string
reasons across four read tools and ordinary private query failure: no pre-abort
query starts, one cancelled completion event per tool and fixed SDK-visible error
text keep the private reason out of results/events. These direct invocations do
not prove full runner signal handling or paid inference.

The original two-test-file source produced nine failures and two passes; a
legacy single-argument Goal Remove call adapter qualifies that red proof. The
fixed two files pass all 11 cases, and six existing Restore controls also pass
(17 total). Web typecheck, six-file lint and whitespace checks passed. No new
browser verification or committed candidate release gate is claimed.

The preceding SDK tracing release is [PR #44](https://github.com/jckail/point_bot/pull/44)
from source `c260cb385cc8b01acb88a9174f5866218deaa8a1`, merged at master
`bbeb8f1d3bfdc2928293bfd6d52dab363efa2d73`. Candidate, prospective master and
actual master have the same tree, `b6fa189c7382428626567c0dd5f48961a2dddc81`.
All six candidate verification jobs in [CI 37055319757](https://github.com/jckail/point_bot/actions/runs/37055319757)
and [CodeQL 37055319754](https://github.com/jckail/point_bot/actions/runs/37055319754)
passed. Merged-master [Deploy 37056080541](https://github.com/jckail/point_bot/actions/runs/37056080541)
and [CodeQL 37056080352](https://github.com/jckail/point_bot/actions/runs/37056080352)
also passed, with 1,790 workspace tests and one paid live skip, including 41 popup
and 12 actual PostgreSQL retention cases. AWS deployment was skipped for missing
deployment-role configuration; these gates do not establish production activation.

The merged four-file PR #45 Restore feedback change returns existing
session/domain error feedback, and each row uses `useActionState`, `FormFeedback`
and `SubmitButton`. Core ownership, fresh seven-day checks, writes, audit/events
and success-only revalidation are preserved. Six actual action/core tests pass;
original behavior produced five failures and one pass with a legacy-call adapter
that qualifies the changed action signature. Typecheck, lint and independent
review passed.

A native React 19 form fixture passed four synthetic server-action outcomes
(session expiry, expired restore window, other error and success), including
pending-button disabling, duplicate prevention, alert/status announcements,
accessible controls and no automatic retry. Its server action was mocked; this
is not authenticated or live-service acceptance. Owned browser page 14 and server
port 55821 were closed. Node PID 2201102 required SIGTERM because `/finish` called
`server.close` but left esbuild running; the wrapper exited 241. Functional browser
assertions passed, but the wrapper was not green. The temporary helper now calls
`esbuild.stop` during cleanup and has not been rerun. Goal Remove feedback is
prepared in the separate current candidate described above.

The preceding hydration-recovery release is [PR #42](https://github.com/jckail/point_bot/pull/42)
from source `fd59f2008ce92024f18d3f8cf1f6ef687490bcdf` (tree
`4c325ad38778c0eae7001ee1f7251a2f1eb05bd5`). Its prospective and actual merged
master `c1293b580dbc07ed88cd241f91ade3e26680c2fb` have tree
`ba03fee7e4a19348b5e23c910c88c28266f8ed5a`. The source and master trees differ
only by two additive `docs/design-audit/{current-source,development}.mdx` files
from concurrent PR #43 at `4aafcb7521940432b7785cbaef66e9a5354d8b8e`;
there is no runtime delta, but the three trees are not all identical. All six
candidate jobs in [CI 37054067412](https://github.com/jckail/point_bot/actions/runs/37054067412),
[CodeQL 37054067371](https://github.com/jckail/point_bot/actions/runs/37054067371)
and Bugbot passed after both valid earlier review findings were fixed. The 1,778
workspace tests and one paid live skip include 41 popup and 12 actual PostgreSQL
retention cases. Merged-master [Deploy 37054589006](https://github.com/jckail/point_bot/actions/runs/37054589006)
passed all six release verification jobs and configuration verification, with
1,778 workspace tests and one paid live skip, including 41 popup and 12 actual
PostgreSQL retention cases. [Master CodeQL 37054588607](https://github.com/jckail/point_bot/actions/runs/37054588607)
also passed. AWS deployment was skipped for missing deployment-role configuration.

The merged PR #44 SDK tracing correction shares one effective-readiness predicate
across runtime trace-ID allocation, emitted events, runner configuration and the
HTTP trace header. It respects tracing opt-in, the environment kill switch and
SDK provider disabling. The existing evaluation helper delegates to that predicate;
CLI override semantics and the HTTP support request ID are unchanged. Six new
runtime/route regressions failed against the original source; all 66 focused tests
across four files and one actual private-exporter bootstrap test now pass (67 total).
Web typecheck, eight-file lint and whitespace checks passed; independent source
review approved the proposal. Candidate and merged-master verification passed as
recorded above. An allocated trace ID proves neither trace creation nor exporter
delivery. No paid inference, cloud exporter delivery or production
activation is established by these checks.

The preceding retention-bounds release is [PR #41](https://github.com/jckail/point_bot/pull/41)
at master `5c52f47ba5a0e8d9e37ead82fa8e549bc73317e2` (source
`92c3d07333e42dbb2e7a407019152ed6c9cb332d`). Both have the same tree,
`1f316ace91178aac457bef22b4b605023f560183`. All six candidate verification jobs
in [CI 37049660507](https://github.com/jckail/point_bot/actions/runs/37049660507),
[CodeQL 37049660366](https://github.com/jckail/point_bot/actions/runs/37049660366)
and Bugbot passed without findings. The 1,760 workspace tests and one paid live
skip include all 12 actual PostgreSQL retention cases. Merged-master
[Deploy 37050353563](https://github.com/jckail/point_bot/actions/runs/37050353563)
passed all six release verification jobs and configuration verification, with
1,760 workspace tests and one paid live skip, including all 12 actual PostgreSQL
retention cases. [Master CodeQL 37050352459](https://github.com/jckail/point_bot/actions/runs/37050352459)
also passed. AWS deployment was skipped for missing deployment-role configuration.
Production rollout
and the broader identity, model/provider and native acceptance gates remain open.

The merged PR #42 extension hydration refinement retains the Ask/Clear dispatch
fence against delayed initial `getChat` results. A bare failure, transport error
or malformed response starts one asynchronous fresh state-only `getChat` recovery;
it never resends the mutation. An authoritative failed chat envelope is applied
directly without an extra read. A second valid review finding showed that a bare
structured failed read could clear an existing pending question before reporting
failure. Such failed reads now preserve the question, guidance and controls;
a successful empty state still clears them. Failed polling shows explicit reopen
guidance without automatically repeating failed polls; recovery reads preserve
an existing pending timer. Failed recovery retains the primary error with reopen
guidance. Successful settings-save fencing is unchanged.

Nine earlier regressions produced seven failures on the original candidate.
The second finding adds three regressions that all failed against `281c261`;
all 41 focused popup tests now pass, with extension typecheck, lint and whitespace
checks passing and independent source review approved without blockers. Both
valid Bugbot findings are addressed in source; the earlier skipped review status
is not an approval. The previous full CI result of 1,775 tests and one paid live
skip applies to `281c261`; the final candidate passed with 1,778 tests and one
paid live skip as recorded above. No native browser proof of this race is claimed.
The merged-master verification also passed as recorded above; PR #41's completed
release evidence remains unchanged.

The preceding extension-draft release is [PR #40](https://github.com/jckail/point_bot/pull/40)
at master `464cb0ec0c7de73403c5aaf5fb24fd5495a78a81` (source
`30a29d6975a7b3375f633c011483c06106a3ea7e`, tree
`6d496fcfd67ae3c53cd0e0c24fe64617ae6314c3`). Candidate
[CI 37047006779](https://github.com/jckail/point_bot/actions/runs/37047006779),
[CodeQL 37047006632](https://github.com/jckail/point_bot/actions/runs/37047006632)
and Bugbot passed, with 1,752 workspace tests and one paid live skip; the three
native popup settings/storage cases also passed. Merged-master
[Deploy 37047566040](https://github.com/jckail/point_bot/actions/runs/37047566040)
failed the existing PostgreSQL retention cap test: batch size 10 and run cap 20
should delete 20 rows in two batches, but deleted 25 in one. The other five release
verification jobs and [master CodeQL 37047565755](https://github.com/jckail/point_bot/actions/runs/37047565755)
passed. AWS deployment remained skipped for missing deployment-role configuration;
that PR #40 merged-master verification failed; successor evidence is above.

The merged PR #41 retention correction claims one materialized ID set per batch, then
uses `DELETE USING` for all four targets without changing retention policy. Twelve
PostgreSQL cases, including eight new cases, passed in candidate CI using uniquely owned schemas
cloned from migrated tables. They cover small direct limits, run caps and concurrent
claims across all targets under adverse planner settings. Independent review, core
typecheck and focused lint passed. The wrapped local PostgreSQL red/green attempt
returned exit 75 before execution: no source substitution or test schemas occurred,
the retained public fixture's 16 outbox rows and 22 migration journal entries were
unchanged, and its container was stopped. No unchanged retry occurred. The later
committed candidate CI supplied the actual database proof. PostgreSQL's documented selector-rescan mechanism supports
the fix; the exact failed runner plan was not observed and remains an inference.
See [retention mechanism and boundaries](events.md#retention-purge-job). This does not complete
production, identity, model/provider, licensing or native web-owner acceptance.

The preceding legacy-grounding release is [PR #39](https://github.com/jckail/point_bot/pull/39)
at master `f88ac067d8c69a5f85d7fd008666f5c1b2a839a2` (source
`b00e3a41048f08e31b18ec9f1a59e338b19ac324`, tree
`60826291085bbd372cdcf763ef81ad844432e5e0`). Candidate
[CI 37045663234](https://github.com/jckail/point_bot/actions/runs/37045663234),
[CodeQL 37045663440](https://github.com/jckail/point_bot/actions/runs/37045663440)
and Bugbot passed, with 1,746 workspace tests and one paid live skip.
All six merged-master verification jobs in
[Deploy 37046175895](https://github.com/jckail/point_bot/actions/runs/37046175895)
and [CodeQL 37046173223](https://github.com/jckail/point_bot/actions/runs/37046173223)
passed. AWS deployment was skipped for missing deployment-role configuration.

The merged PR #40 extension settings fix clears the assistant question draft after every
successful save and preserves it on failure. Six new regressions produced five
failures on the original source; all 23 focused popup tests then passed, along
with extension typecheck and lint. Independent source review approved the fix.
Root's fresh wrapped extension build and native verification lease completed
successfully. The current application installed from the approved UNC path with
its current manifest, including PR #35's exact loopback grants. One owned actual
popup verified token rotation clears the draft and stores the new token while
preserving the origin; endpoint rotation clears the draft and stores the canonical
origin while preserving the token; an unsafe URL preserves the draft and saved
credentials. The service-worker fetch stub blocked all networking, with zero
outgoing fetches observed. Owned storage was cleared, the popup closed, the
extension uninstalled and the loopback verification server stopped; the original
about:blank tab was untouched. This proves current application installation and
settings UI/storage behavior only. Worker-busy and storage-write failures remain
fake-DOM test evidence; live authentication, inference, endpoint/provider behavior
and MV3 termination remain open. See [native evidence](chrome-extension-acceptance.md).

The preceding owner-isolation release is [PR #38](https://github.com/jckail/point_bot/pull/38)
at master `371ecfecee42a0a3d57ef05ed5c30bdfbc2e25dc` (source
`cdd9bc95ce964f6cb00e04a7c8e9f8420b911518`, tree
`33655c4f8bc7b0673e68bb34ef6785976bac2e7c`). Candidate
[CI 37044660484](https://github.com/jckail/point_bot/actions/runs/37044660484),
[CodeQL 37044660355](https://github.com/jckail/point_bot/actions/runs/37044660355)
and Bugbot passed, with 1,739 workspace tests and one paid live skip.
Merged-master [Deploy 37045081965](https://github.com/jckail/point_bot/actions/runs/37045081965)
and [CodeQL 37045081393](https://github.com/jckail/point_bot/actions/runs/37045081393)
passed all six release verification jobs and CodeQL, with 1,739 workspace tests
and one paid live skip. AWS deployment was skipped for missing deployment-role
configuration. The controlled native owner-change fixture did not execute because
the shared gate returned exit 75;
no new native browser or live-auth acceptance is claimed.

## Grounded reads and pending proposals

Read tools close over the authenticated branded `UserId`; model input cannot select another owner. They expose portfolio totals, balances, goal progress and existing editorial value advice. PR14's optimizer, bonus-aware advice, catalog, readiness and other assistant services remain composed. Balance projections include opaque PointUp account IDs for proposal targeting, program labels, points, capture time, expiry and estimates. They exclude membership numbers, notes and stored credentials. Goal reads exclude notes and account IDs. Messages and selected portfolio data are sent to OpenAI for inference in agents mode.

The merged PR #39 legacy assistant grounding fix labels bonus-adjusted hints
explicitly verified or unverified and uses only bounded `manual`, `scraped`, `user`
or `unknown` source classifications. Only literal `true` establishes verified
status; the prompt requires issuer confirmation for an unverified or unknown
bonus. It adds no URLs or private fields and preserves card eligibility, owner
visibility and time-window rules. The seven new regressions first reproduced
five failures and two passes on the original source; after the fix, all 20 focused
tests across three files passed, with core typecheck, two-file lint and whitespace
checks passing. Independent review approved the source. These checks do not
establish live issuer terms, provider behavior or model compliance.

Two extra tools prepare manual balance observations or trip goals. They persist typed, immutable values in `assistant_action` and return pending review DTOs; they never execute the mutation. Review the exact values at `/dashboard/agents#review-actions`. Provider pages and model claims are untrusted data, never consent.

Agents mode also exposes `estimate_transfer` for an exact owned source account,
destination program and positive safe-integer amount. It uses the account's saved
card selection and the same dated eligibility resolver as advice and funding;
model arguments cannot override the owner or card. This avoids treating omission
from the ranked advice list as proof that a route is unavailable. The result gives
the resolved ratio, available public eligibility source/effective date, base and
bonus-adjusted yields, balance capture time and saved balance sufficiency. Unknown
or excluded conditional rules return no numeric estimate. Catalog limits and
unverified bonuses are identified separately; saved points do not establish issuer
access, card-combining permission or live award inventory. This read tool executes
no transfer or booking. Legacy chat does not expose this exact-route tool.

Deal affordability also resolves the saved source card and visible bonuses. Its
advice DTO includes the exact required source points, resolved ratio and rule
metadata or a missing-route/eligibility reason. Direct destination points remain
usable; partial destination points reduce the amount that would need transferring.
Unknown issuer limits stay unknown. A sufficient saved balance is an estimate,
not verified transfer eligibility, a live redemption price or available inventory.

`POST /api/v1/assistant/actions` requires `portfolio:write` and accepts either `{kind:"manual_balance",accountId,points,capturedAt?}` or `{kind:"trip_goal",title,targetPoints,targetDate?,accountIds?,notes?}`. Server services establish ownership, program labels, status, expiry and identifiers. `GET /api/v1/assistant/actions` requires `portfolio:read` and lists at most 50 recent owned proposals. Missing and foreign proposals receive the same 404.

`POST /api/v1/assistant/actions/:id/approve` and `/reject` require a browser cookie session and reject personal-token and Clerk-bearer credentials. Their request body is empty or `{}`; payload overrides are rejected. The existing CSRF boundary protects cookie mutations. These endpoints return `{action: AssistantActionDto}` and use private, uncached responses.

A proposal expires after 15 minutes. Approval atomically claims an unexpired pending row, rechecks account ownership and invokes the existing owner-checked use case with the saved payload. Concurrent approvals cannot claim twice; replay returns the durable outcome. Rejection and expiry never execute. Pending settlement returns only safe metadata
for the row actually transitioned; a competing or repeated caller gets no receipt.
List, approval and rejection audit those receipts after persistence returns, including
expiry after a claim waits for its row lock. Audit fields are action ID, kind and
status, without proposal payloads or private account witnesses. Sink failures do
not change the durable outcome. This is best-effort telemetry: a process crash after
the database transition can still lose its event, and these logs are not a durable
audit journal. Statuses are `pending`, `executing`, `succeeded`, `rejected`, `expired`, `failed` and `unknown`.

The transition receipt changes are merged through [PR #37](https://github.com/jckail/point_bot/pull/37)
at master `26643eccf2087f19df36e3299ed577627387263b`, from source
`b65afd58c8f8862198e4fd57e9c96e8c7683c097` (tree
`bb774ef7501810d354feca0c733d8a32f427d44f`). Candidate
[CI 37042066067](https://github.com/jckail/point_bot/actions/runs/37042066067),
[CodeQL 37042066082](https://github.com/jckail/point_bot/actions/runs/37042066082)
and Bugbot passed;
merged-master [verification](https://github.com/jckail/point_bot/actions/runs/37042811100)
and [CodeQL](https://github.com/jckail/point_bot/actions/runs/37042810552) passed.
The 1,739 passing workspace tests include 17 actual PostgreSQL assistant-action
cases, with one paid live skip. The local database attempt was blocked before
execution by the shared gate (exit 75); CI supplies the database evidence. AWS
activation remains skipped for missing deployment-role configuration.

Manual-balance proposals also retain private account-identity evidence: a fresh
random nonce and digest bound to the owner, account, provider and exact saved
membership number. Neither the number nor this evidence is returned in proposal
DTOs or model tools. Approval checks it again under the account mutation lock
before writing a balance, activity or outbox event. A changed membership requires
a newly reviewed proposal. Pending legacy proposals without valid evidence fail
closed; existing terminal outcomes and trip-goal proposals remain readable.
Only the exact pre-write guard rejection establishes `PRECONDITION_FAILED`;
wrapped transaction errors and uncertain commit outcomes remain `unknown`.

Trip-goal account references are validated under the same account locks used by
unlink/import, then the current goal row is locked before applying changes.
Omitting `accountIds` preserves associations without rewriting their foreign
keys; an explicit empty array clears them. Repeated account IDs count once,
preserving their first requested order in storage and progress calculations.
Database goal locking requires an atomic unit of work; mismatched compositions
fail closed rather than silently releasing a lock before mutation.

PR14's production composition supplies the shared ambient UnitOfWork to the proposal service and repository. The approved portfolio mutation, its domain-event outbox writes and successful proposal journal update commit in one database transaction. The initial execution claim remains durable outside that transaction. A transaction or commit exception alone cannot prove rollback; recovery marks an executing claim `unknown` without overwriting a success that committed before an acknowledgement was lost. Executions stalled for five minutes become visibly unknown when inspected. Automatic replay is never authorized. Hosts without an atomic UnitOfWork retain the conservative unknown-outcome fallback. Inspect the portfolio before creating a separately reviewed replacement proposal.

Chat preserves `reply` and adds optional `actions` for proposals persisted during the run. The canonical list survives request failure and restart; the review UI refreshes after success or failure. DTOs contain `id`, `kind`, `status`, `title`, `summary`, `payload`, timestamps, `result` and `failureCode`. Browser components render saved values as plain text. Model HTML and executable instructions are not accepted.

## Bounds and diagnostics

The deadline helper observes already-started work even if cancellation occurs
before the helper is entered. A late adapter rejection is handled without waiting
for completion or exposing its private error. This does not cancel storage work
that has already started or establish that a proposal was never persisted.

The entire UTF-8 JSON chat body is limited to 32 KiB, including serialized history. Within that aggregate bound, limits are 4,000 message characters, 16 history entries, five proposal attempts per run, 64 KB of serialized tool output, 50 balance accounts, 30 goals, 10 advice entries per category and 1,200 model output tokens per request. `ASSISTANT_MAX_TURNS` defaults to 5 (range 1–12); `ASSISTANT_TIMEOUT_MS` defaults to 30,000 (range 1,000–120,000). Extension calls cap the configured deadline at 20 seconds to leave margin before Chrome's service-worker fetch response limit; a surface header can only shorten the deadline. A storage operation or provider request already in flight may outlive cancellation. Failures return a generic `ASSISTANT_UNAVAILABLE`; agents mode never silently switches providers or invents a successful result.

Process-local admission allows ten requests per sliding minute and two concurrent requests per authenticated owner, with sixteen concurrent runs per web process. Cookie and token requests for the same owner share these bounds. Rejections return private HTTP 429 with `Retry-After` before loading portfolio services. Leases release on success, failure and cancellation. Replicas enforce separate limits; this is not a distributed or monetary quota.

PR14 accepts or generates the canonical `x-request-id` and echoes it; `X-PointUp-Request-Id` is a compatibility alias. `X-PointUp-Assistant-Mode` reports agents or fallback. Traced runs expose `X-PointUp-Trace-Id`; SDK trace IDs are generated independently of caller correlation IDs. `X-PointUp-Surface: web|extension` labels a bounded surface and grants no authority.

The `pointup_assistant` log component records run and SDK lifecycle events, bounded outcomes, duration, turns, model requests and measured usage, including partial usage when available. The SDK reference is `sdkTraceId`, preserving the logger's existing OpenTelemetry `traceId` and `spanId`. Known usage fields become `inputTokenCount`, `outputTokenCount`, `totalTokenCount`, `cachedInputTokenCount` and `reasoningOutputTokenCount`; only nonnegative safe integers under these exact case-insensitive names bypass token-key redaction. Cached and reasoning counts are subsets of totals, not additional tokens. Counts do not establish billed cost.

The `assistant_run_duration_ms` histogram records both completed and failed
terminal runs, including timeout, cancellation and max-turn outcomes. Its dimensions
are bounded source, mode and outcome; request, trace and tool identifiers stay out
of metrics. Started runs and SDK lifecycle hooks add no duration samples. Invalid
durations are omitted and sink failures remain isolated. These distributions
measure operational latency, not billed cost or cloud delivery.

A separate `pointup_assistant_http` component records `request_completed` or `request_failed`, the support reference, bounded surface, numeric `httpStatus` and duration. Authentication, admission and setup failures remain searchable without being counted as started SDK runs. Logs exclude prompts, replies, proposal payloads, user IDs, credentials and raw provider errors. Observer failures do not change the response.

## Trace privacy and verification

Local transport acceptance now uses real OpenTelemetry trace and metric HTTP
exporters against an owned loopback collector. Actual MCP calls verify serialized
spans/metrics, log correlation, fixed failure diagnostics and exclusion of private
token/provider-error canaries. A collector rejection leaves application replies
successful. The metrics adapter rebinds instruments when the host registers or
replaces the global provider, fixing startup's permanently captured no-op meter.
Earlier counter/histogram observations are not replayed; gauges retain their latest
values. This proves bounded local delivery, not cloud collector/dashboard
arrival, OpenAI SDK trace delivery or production bootstrap behavior. Web and MCP
telemetry initialization failures also log a fixed diagnostic rather than raw
exporter exception text, which may contain credential-bearing URLs.

Effective tracing uses the same readiness predicate for runtime allocation, SDK events,
runner settings and the response header. A caller-supplied SDK trace ID cannot
override opt-in, the kill switch or provider disabling. The diagnostic HTTP support
ID remains available independently.

Trace export defaults off. `ASSISTANT_TRACING_ENABLED=true` requests SDK model/tool/task/turn spans with `traceIncludeSensitiveData:false` and model `store:false`. `OPENAI_AGENTS_DISABLE_TRACING=1` or `true` disables SDK tracing globally. Exported metadata contains only a server-generated `run_id`, bounded surface and runtime, never caller-supplied HTTP correlation values.

Before the first traced production run, a synchronous process/HMR-safe initializer replaces the default SDK processor with a sanitizer. It forwards cloned spans with fixed failure metadata, closing SDK 0.18's provider-exception leak even when sensitive-data tracing is disabled. Span IDs, parent IDs, timing and safe metadata remain; original exceptions are unchanged. PR14's OpenTelemetry adapter and structured logger independently sanitize exception diagnostics, retaining fixed categories and validated public error codes. The SDK sanitizer alone does not protect application telemetry.

Export is asynchronous; a returned trace ID is not delivery evidence. Chat requests do not synchronously flush. The explicitly opted-in synthetic evaluation CLI performs one bounded teardown flush and reports requested/effective tracing separately. See [assistant-evaluations.md](assistant-evaluations.md) for all twelve cases, automated checks and the manual rubric. Scripted models and mocked HTTP regressions verify wiring and privacy boundaries, not live-model behavior, deployment trace delivery, Chrome lifetime behavior or database/outbox delivery. No paid live inference was run during the port.

See [observability.md](observability.md) for existing application telemetry and the assistant CloudWatch configuration. Runtime activation requires an explicitly configured model and a web-only OpenAI secret; tracing is a separate opt-in. Source and template changes do not deploy the runtime.

The web panel generates a diagnostic request UUID before sending chat and prefers
validated server support references. A failed, stopped or timed-out response does
not prove that a pending proposal was never saved: persistence can finish after
the response deadline. The panel retains the question and tells the user to check
proposed changes before explicitly retrying. Refresh proposed changes reloads the
existing review list; the dashboard review link remains available. No failure
automatically resends or approves a proposal.

The dashboard passes its authoritative signed-in owner into a keyed panel. One
sessionStorage envelope per tab retains displayed turns and the current draft,
with a 24-hour expiry, 40-turn/4,000-character limits and a 64 KiB UTF-8 bound.
Oldest displayed turns are dropped first. Unknown, corrupt, expired or foreign-owner
envelopes are discarded. The pending question and request reference are saved before
the HTTP attempt; returning after navigation or reload restores an uncertain outcome
and directs the user to inspect current proposed changes. It never replays the request.
Clear chat removes recovery. Storage denial or quota failure leaves the current chat
usable and reports unavailable recovery; credentials, exception text and proposal
payloads are not stored. Owner replacement/unmount invalidates the old persistence
lease, and aborted late responses cannot become confirmed answers.

The merged PR #38 agents-page fix keys both its management and proposal-review
panels by the authoritative signed-in owner. Owner replacement remounts both;
same-owner refresh preserves local state. Independent source review and focused
lint/type checks passed. The controlled native fixture did not execute because
the shared verification queue returned exit 75; it was not retried unchanged.
This source change adds no browser or live-auth acceptance claim.

Root exercised the actual development React/Next dashboard in one isolated Chrome
tab with synthetic requests: draft reload, stop followed by an abort-ignoring late
success, interrupted-request navigation and return with zero automatic sends, and
Clear followed by reload. The owned tab and server were closed. This bounded check
uses development authentication and synthetic fetch responses; live Clerk owner
switching, Chrome extension/provider behavior and paid inference remain open.

References: [SDK tools](https://openai.github.io/openai-agents-js/guides/tools/), [running agents](https://openai.github.io/openai-agents-js/guides/running-agents/), [tracing](https://openai.github.io/openai-agents-js/guides/tracing/), and [Chrome service-worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
