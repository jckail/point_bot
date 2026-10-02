# PointUp product and engineering guide

PointUp manages loyalty balances, travel goals, estimated value, expiration evidence,
and assisted balance collection. The web app and Chrome extension are the current
product scope; an iOS client is a later consumer of the same contracts.

## Start here

- [Architecture](architecture.md): TypeScript domain, use cases, ports and adapters.
- [API](api.md): authenticated v1 routes and generated OpenAPI contracts.
- [Design](design.md): product navigation, visual system, accessibility and review.
- [Chrome extension](extension.md): explicit capture, permissions, review and testing.
- [Agents and integrations](agents.md): MCP setup, consent and client limitations.
- [Assistant agent](assistant-agent.md): shared SDK runtime and reviewed actions.
- [Assistant evaluations](assistant-evaluations.md): synthetic scenarios, deterministic checks and explicit live runs.
- [Observability](observability.md): SDK tracing, CloudWatch metrics, dashboard and alarms.
- [ChatGPT identity](chatgpt-sign-in.md): registered OIDC linking and setup boundaries.
- [Core audit](core-audit.md): concrete integrity findings and remaining work.
- [Verification](verification.md): exact checks, source identity and runtime gaps.
- [Database verification](database-verification.md): disposable PostgreSQL evidence.
- [Provider capabilities](provider-capabilities.md): official sources and access gates.
- [Overhaul status](overhaul-status.md): requirement-level evidence and next gates.

## Documentation rules

Describe current source separately from deployments, provider partnerships and planned
features. A passing unit test does not establish a live provider integration, a production
migration or a published extension. Keep official external references with their setup
requirements, and never include credentials, session tokens or private account data.

Record material behavior changes and remaining verification next to the owning feature.
The generated OpenAPI document is the wire contract; check actual route responses when
updating it. Architectural proposals must state the migration and rollback path before
being described as implemented.

- [Portfolio data model](portfolio-data-model.md): tenant-qualified goal membership, tag storage, backfill review and atomic writes.
