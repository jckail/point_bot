# PointUp assistant agent and reviewed actions

The web dashboard and extension share authenticated `POST /api/v1/assistant/chat`. `ASSISTANT_RUNTIME=legacy` preserves PR14's existing provider selection, including Bedrock, the OpenAI-compatible adapter and the heuristic fallback. Set `ASSISTANT_RUNTIME=agents`, a server-only `OPENAI_API_KEY`, and an explicit `ASSISTANT_MODEL` to use the TypeScript OpenAI Agents SDK. PointUp personal access tokens authorize portfolio access; they are not inference credentials.

The route retains PR14's shared authentication, rate limiting, CSRF checks, request telemetry and error mapping. Chat requires `portfolio:read`. Cookie sessions and tokens with `portfolio:write` receive proposal tools; read-only tokens receive only read tools. Legacy chat does not propose changes. No model or token can approve a proposal through a chat tool.

## Grounded reads and pending proposals

Read tools close over the authenticated branded `UserId`; model input cannot select another owner. They expose portfolio totals, balances, goal progress and existing editorial value advice. PR14's optimizer, bonus-aware advice, catalog, readiness and other assistant services remain composed. Balance projections include opaque PointUp account IDs for proposal targeting, program labels, points, capture time, expiry and estimates. They exclude membership numbers, notes and stored credentials. Goal reads exclude notes and account IDs. Messages and selected portfolio data are sent to OpenAI for inference in agents mode.

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

A proposal expires after 15 minutes. Approval atomically claims an unexpired pending row, rechecks account ownership and invokes the existing owner-checked use case with the saved payload. Concurrent approvals cannot claim twice; replay returns the durable outcome. Rejection and expiry never execute. Statuses are `pending`, `executing`, `succeeded`, `rejected`, `expired`, `failed` and `unknown`.

PR14's production composition supplies the shared ambient UnitOfWork to the proposal service and repository. The approved portfolio mutation, its domain-event outbox writes and successful proposal journal update commit in one database transaction. The initial execution claim remains durable outside that transaction. A transaction or commit exception alone cannot prove rollback; recovery marks an executing claim `unknown` without overwriting a success that committed before an acknowledgement was lost. Executions stalled for five minutes become visibly unknown when inspected. Automatic replay is never authorized. Hosts without an atomic UnitOfWork retain the conservative unknown-outcome fallback. Inspect the portfolio before creating a separately reviewed replacement proposal.

Chat preserves `reply` and adds optional `actions` for proposals persisted during the run. The canonical list survives request failure and restart; the review UI refreshes after success or failure. DTOs contain `id`, `kind`, `status`, `title`, `summary`, `payload`, timestamps, `result` and `failureCode`. Browser components render saved values as plain text. Model HTML and executable instructions are not accepted.

## Bounds and diagnostics

The entire UTF-8 JSON chat body is limited to 32 KiB, including serialized history. Within that aggregate bound, limits are 4,000 message characters, 16 history entries, five proposal attempts per run, 64 KB of serialized tool output, 50 balance accounts, 30 goals, 10 advice entries per category and 1,200 model output tokens per request. `ASSISTANT_MAX_TURNS` defaults to 5 (range 1–12); `ASSISTANT_TIMEOUT_MS` defaults to 30,000 (range 1,000–120,000). Extension calls cap the configured deadline at 20 seconds to leave margin before Chrome's service-worker fetch response limit; a surface header can only shorten the deadline. A storage operation or provider request already in flight may outlive cancellation. Failures return a generic `ASSISTANT_UNAVAILABLE`; agents mode never silently switches providers or invents a successful result.

Process-local admission allows ten requests per sliding minute and two concurrent requests per authenticated owner, with sixteen concurrent runs per web process. Cookie and token requests for the same owner share these bounds. Rejections return private HTTP 429 with `Retry-After` before loading portfolio services. Leases release on success, failure and cancellation. Replicas enforce separate limits; this is not a distributed or monetary quota.

PR14 accepts or generates the canonical `x-request-id` and echoes it; `X-PointUp-Request-Id` is a compatibility alias. `X-PointUp-Assistant-Mode` reports agents or fallback. Traced runs expose `X-PointUp-Trace-Id`; SDK trace IDs are generated independently of caller correlation IDs. `X-PointUp-Surface: web|extension` labels a bounded surface and grants no authority.

The `pointup_assistant` log component records run and SDK lifecycle events, bounded outcomes, duration, turns, model requests and measured usage, including partial usage when available. The SDK reference is `sdkTraceId`, preserving the logger's existing OpenTelemetry `traceId` and `spanId`. Known usage fields become `inputTokenCount`, `outputTokenCount`, `totalTokenCount`, `cachedInputTokenCount` and `reasoningOutputTokenCount`; only nonnegative safe integers under these exact case-insensitive names bypass token-key redaction. Cached and reasoning counts are subsets of totals, not additional tokens. Counts do not establish billed cost.

A separate `pointup_assistant_http` component records `request_completed` or `request_failed`, the support reference, bounded surface, numeric `httpStatus` and duration. Authentication, admission and setup failures remain searchable without being counted as started SDK runs. Logs exclude prompts, replies, proposal payloads, user IDs, credentials and raw provider errors. Observer failures do not change the response.

## Trace privacy and verification

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

Root exercised the actual development React/Next dashboard in one isolated Chrome
tab with synthetic requests: draft reload, stop followed by an abort-ignoring late
success, interrupted-request navigation and return with zero automatic sends, and
Clear followed by reload. The owned tab and server were closed. This bounded check
uses development authentication and synthetic fetch responses; live Clerk owner
switching, Chrome extension/provider behavior and paid inference remain open.

References: [SDK tools](https://openai.github.io/openai-agents-js/guides/tools/), [running agents](https://openai.github.io/openai-agents-js/guides/running-agents/), [tracing](https://openai.github.io/openai-agents-js/guides/tracing/), and [Chrome service-worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
