# Assistant observability

The web and extension use the same server-side TypeScript OpenAI Agents SDK runtime.
SDK tracing and structured application logs complement one another. See
[assistant-agent.md](assistant-agent.md) for tool boundaries and trace privacy.
No production infrastructure, inference call or trace export has been exercised here.

## Runtime and trace configuration

Enable `ASSISTANT_RUNTIME=agents`, configure server-only `OPENAI_API_KEY`, and set
an explicit `ASSISTANT_MODEL` that your OpenAI project can access. Inference and
trace export can incur charges. `ASSISTANT_TRACING_ENABLED=true` opts into SDK
model, tool, task and turn spans. Sensitive span data stays disabled and model
response storage is disabled. `OPENAI_AGENTS_DISABLE_TRACING=1` or `true` disables
SDK export globally. A process-initialized wrapper replaces the default exporter
processor and sanitizes cloned span errors before export. This also covers the
installed SDK response model, whose provider exceptions can otherwise survive
the sensitive-data setting. The wrapper preserves identifiers, timing, usage and
safe span metadata; error messages/data become a fixed category. Synthetic tests
exercise thrown provider errors and mocked HTTP 400 responses without live calls. Request IDs correlate replies and lifecycle logs; trace IDs identify
requested traces and do not confirm that export succeeded.

This ECS application runs as a persistent process, letting the SDK's batch
exporter operate. Verify actual delivery in OpenAI's trace viewer before relying
on it. A future short-lived/serverless host needs a bounded after-response flush.
Logs omit chat text, tool payloads, raw user IDs and credentials. Proposal review
has its own metadata-only audit outcomes; account changes remain visible in the
portfolio activity history.

Every assistant HTTP response also records safe request-level metadata under
`pointup_assistant_http`, including the server-generated support ID, client
surface, status and duration. This covers authorization/configuration failures
before an SDK run starts without counting those requests as failed model runs.
The dashboard failure query includes HTTP server errors alongside SDK failures.

## Infrastructure source

`infra/lib/app-stack.ts` now provisions a retained application log group with
30-day retention and a CloudWatch assistant dashboard. CDK context
`enableAgents=true` requires `assistantModel=<approved-model>` and creates a
separate Secrets Manager credential placeholder injected only into the web task.
Populate it with a real OpenAI API key before using the runtime; the generated
placeholder cannot perform inference. `assistantTracing=true` is a separate
export opt-in. Without these settings the existing assistant configuration stays
in effect. Configuration changes are source only; this work does not deploy them.

Fourteen JSON log metric filters record started/completed/failed/cancelled runs,
timeouts, maximum-turn stops, completed run and tool latency, failed tools, model
requests and input/output token counts, plus reported cached input and reasoning
output tokens. Detail counts are omitted when unavailable, rather than represented
as measured zero, and include only allowlisted safe integers. These details are
subsets of the input/output totals; adding them to those totals would double count.
Token counts include partial usage when available on failure. Metrics have no request/user dimensions. Support IDs stay
in searchable logs. Counts do not establish billed cost: provider pricing,
pricing interpretation and exporter delivery need separate evidence.

The dashboard shows run outcomes, p50/p95 latency, tokens and model requests,
plus a recent-failure Logs Insights query with request and trace references.
An alarm fires at at least 20% failures in two of three five-minute periods,
only when a period contains at least ten started runs. Cancellations are excluded;
timeouts and maximum-turn stops count as failures. A second alarm requires at
least five timeouts in two consecutive five-minute periods. Missing data does
not breach either alarm. Started/outcome events can cross time buckets, so the
percentage is an operational signal rather than an exact cohort error rate.
Alarms currently have no notification action; configure an operational recipient
before treating them as paging. Thresholds require tuning against actual traffic.

CloudWatch log ingestion/storage, custom metrics, dashboard queries and alarms
have infrastructure costs. Review the synthesized stack and account pricing
before deploying. CDK template tests check filter counts, cancellation handling,
minimum-volume alarm logic, low cardinality, web-only secret injection and disabled
configuration; they do not verify AWS log ingestion or alert delivery.

The separate infra dependency audit still reports one high advisory in
`aws-cdk-lib`'s bundled `brace-expansion`, despite a compatible CDK update. It is
separate from the application production dependency audit; no forced or manually
patched bundled upgrade was applied.

References: [OpenAI SDK tracing](https://openai.github.io/openai-agents-js/guides/tracing/),
[AWS CDK metric filters](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_logs.MetricFilter.html),
[CloudWatch dashboards](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Dashboard.html).
