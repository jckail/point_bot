# @pointup/core

Framework-agnostic heart of PointUp: the domain layer (entities, provider catalog, repository ports, coded errors), application layer (use cases and outbound ports), wire contracts (zod schemas under `@pointup/core/contracts`), and infrastructure adapters (Drizzle repositories, travel-provider gateways, credential vaults).

No Next.js, React, or environment coupling — any host (web app, worker, CLI, future surface backends) builds its own composition root on top of this package. See [docs/architecture.md](../../docs/architecture.md).
