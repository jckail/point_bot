# PointUp assistant agent and reviewed actions

The web dashboard and extension share authenticated `POST /api/v1/assistant/chat`. Default `ASSISTANT_RUNTIME=legacy` preserves the core assistant configuration, including its heuristic when no model provider is configured. Set `ASSISTANT_RUNTIME=agents`, a server-only `OPENAI_API_KEY`, and explicit `ASSISTANT_MODEL` enabled in your OpenAI project for the real TypeScript OpenAI Agents SDK. ChatGPT identity tokens and PointUp personal agent tokens are not OpenAI inference credentials.

The agent reads totals, balances, trip goal progress, and editorial value advice. Tools close over the authenticated owner supplied by the route; a model cannot choose another user. Balance results include opaque PointUp account IDs needed to target a reviewed proposal, program labels, points, capture time, expiry, and estimated value. Membership numbers, stored-credential flags, and account notes are excluded. Read goal tools exclude notes and account IDs. User messages and relevant portfolio data are sent to OpenAI for inference in agents mode.

With proposal authority, two extra SDK tools prepare manual balance observations and trip goals. They persist typed, immutable values in `assistant_action`; they never execute account mutations. A session user can propose; a personal agent token needs both `assistant:chat` and `actions:propose` for these tools. The user reviews the exact account/program/points/time or goal fields in `/dashboard/settings`, then explicitly approves or rejects. Provider page text and model claims are untrusted data, never consent. Agents with only `assistant:chat` receive read tools; the legacy assistant does not propose changes.

`POST /api/v1/assistant/actions` with `actions:propose` also creates proposals for external agents/MCP. Its strict request union accepts either `{kind:"manual_balance",accountId,points,capturedAt?}` or `{kind:"trip_goal",title,targetPoints,targetDate?,accountIds?,notes?}`. Ownership, provider names, status, expiry, and action IDs come from the server. The response is `{action: AssistantActionDto}`. Proposing is not approval.

`GET /api/v1/assistant/actions` lists at most 50 recent owned proposals and outcomes. `POST /api/v1/assistant/actions/:id/approve` or `/reject` accepts only `{}`; payload overrides are rejected. These three review endpoints require a first-party cookie session and reject Authorization headers, including PAT and Clerk bearer credentials. Mutation requests must pass the shared same-origin browser check. The response is `{action: AssistantActionDto}`; missing or foreign actions return the same 404. Review results remain private and uncached.

A proposal expires after 15 minutes. Approval atomically claims an unexpired `pending` row as `executing`, rechecks referenced accounts, then invokes the existing owner-checked balance or goal use case with only the saved payload. Concurrent approvals cannot claim twice. Replay returns the persisted status/outcome. Rejection and expiry never execute. Exact statuses are `pending`, `executing`, `succeeded`, `rejected`, `expired`, `failed`, and `unknown`.

Existing mutations and the proposal journal are not one database transaction. An exception after the mutation boundary means `unknown`: a balance or goal may already exist. The server never retries it automatically. A failed journal write leaves the durable claim intact; listing/approval later changes executions stalled for five minutes to visible `unknown`. This favors at-most-once invocation over automatic recovery. The user must inspect their portfolio before making a separately reviewed replacement proposal. `failed` is reserved for a precondition failure before invoking mutation. The journal persists payload, status, timestamps, sanitized result, and bounded failure code; structured audit logs record claims and outcomes without payloads or user IDs. PostgreSQL concurrency and live deployment validation remain separate smoke checks; focused tests exercise concurrent approvals with the repository port and actual core use cases.

The chat response preserves `reply` and adds optional `actions` containing newly persisted proposals from that run. Canonical listing survives request failure and process restart; the UI refreshes it after success or failure. DTO fields are `id`, `kind`, `status`, `title`, `summary`, `payload`, `createdAt`, `updatedAt`, `expiresAt`, `result`, and `failureCode`. Manual payloads contain `accountId`, `providerId`, `providerName`, `points`, and `capturedAt`. Goal payloads contain `title`, `targetPoints`, `targetDate`, `accountIds`, `accountNames`, and `notes`. Fixed browser components render these as plain text. No model HTML or executable instructions are accepted.

Limits: messages at most 4,000 characters, history at most 16 entries, five proposal attempts per chat run, tool output at most 64 KB, 50 balance accounts, 30 read goals, 10 advice entries per category, and 1,200 model output tokens. `ASSISTANT_MAX_TURNS` defaults to 5 (1–12); `ASSISTANT_TIMEOUT_MS` defaults to 30,000 (1,000–120,000). Abort signals and response deadlines bound chat latency, though a storage read or proposal insert already in progress can finish after cancellation. A configured SDK failure returns `ASSISTANT_UNAVAILABLE` and never fabricates an answer or silently changes providers. There are no booking, point-transfer, provider-login, shell, file-access, or arbitrary browsing tools.

`X-PointUp-Request-Id` correlates responses with logs; `X-PointUp-Assistant-Mode` is `agents` or `fallback`. With trace export requested, `X-PointUp-Trace-Id` correlates runs, including failures after run start. A bounded `X-PointUp-Surface: web|extension` header classifies diagnostics without granting access. All correlation IDs originate on the server.

Structured logs include bounded surface and mode, run start/outcome/duration, SDK agent/tool lifecycle hooks, tool duration/status, completed model turns, model request count, and token usage (partial when available on failure). Failure classifications are timeout, cancellation, maximum turns, or other failure. Logs exclude raw messages, payloads, membership numbers, user IDs, API keys, and provider error bodies. Observer failure cannot change request success. Deployment log collection and dashboards are configured separately.

Reported cached input and reasoning output tokens are allowlisted numeric usage
details, included on successful and partial runs when available. They are subsets
of the input/output totals. Request-level HTTP logs also preserve support-ID
correlation for failures before the SDK starts, without inflating model-run counts.

Extension requests use at most a 20-second server deadline, leaving margin before
Chrome's service-worker fetch response limit. Web/API requests retain the configured
deadline (up to 120 seconds). The surface header can only shorten this deadline;
it grants no additional authority. See [Chrome's service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Admission limits apply to every assistant runtime: ten admitted requests per
sliding minute and two concurrent requests per authenticated owner, with sixteen
concurrent requests per web process. Cookies and PATs belonging to the same owner
share limits. Rejected requests return private HTTP 429 and `Retry-After` before
loading portfolio services or invoking a model. Admitted failures consume the
request allowance, and concurrency slots are released on success, failure or
cancellation. The bounded in-memory owner map expires idle entries. Each replica
has its own limits; this is process protection, not a distributed or billing quota.

Trace export is off by default. `ASSISTANT_TRACING_ENABLED=true` opts into OpenAI model/tool/task/turn spans; `traceIncludeSensitiveData` is always false. Metadata contains only request ID, bounded surface, and runtime. Model `store` is false. `OPENAI_AGENTS_DISABLE_TRACING=1` or `true` additionally disables SDK tracing globally. Before the first traced live run, PointUp replaces the SDK exporter processor with a wrapper that clones spans and substitutes a fixed error category/message. This closes an SDK 0.18 response-span path that otherwise retains provider exception text/data despite sensitive-data tracing being disabled. Trace/span/parent IDs, timing, usage and safe metadata remain available; the original exception is not modified. Initialization runs once per SDK provider across concurrent requests and module reloads. IDs indicate tracing was requested, not confirmed delivery; export is asynchronous. Short-lived/serverless deployments need a bounded after-response `forceFlush()` integration before relying on delivery.

Nine SDK tests use an injected protocol Model to verify real Runner/tool loops, server-bound proposals, read-only tool availability, trace exclusion, telemetry, deadlines, maximum turns, and fallback without API cost. Three additional usage tests check optional token details, unknown fields and invalid/overflowing counts. Eleven core action tests cover immutable proposals, normalized review values, actual owner-checked mutations, concurrent approval/replay, changed ownership, expiry/rejection, restart, and unknown outcomes after mutation or journal failure. Live OpenAI model access, authenticated browser behavior, current portfolio normalization, trace delivery, and host installation require deployment smoke testing.

References: [SDK tools](https://openai.github.io/openai-agents-js/guides/tools/), [running agents](https://openai.github.io/openai-agents-js/guides/running-agents/), and [tracing controls](https://openai.github.io/openai-agents-js/guides/tracing/).

See [assistant-evaluations.md](assistant-evaluations.md) for eleven deterministic evaluation checks and the opt-in synthetic live model evaluation harness. No live inference was performed.
