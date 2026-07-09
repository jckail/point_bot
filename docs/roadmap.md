# PointUp feature roadmap

This roadmap is organized into phases sequenced by dependency, not by dates: each phase builds on capabilities the previous one puts in place. Within a phase, items are independent and can ship in any order. Status: ✅ shipped, 🔜 next up, 🔮 later.

## Foundation (shipped)

The platform baseline everything below builds on:

- ✅ DDD/hexagonal core (`@pointup/core`) with ports for providers, vaults, and persistence
- ✅ Versioned HTTP API with strict zod contracts and typed client (`@pointup/api-client`)
- ✅ Clerk user management; Drizzle + PostgreSQL; AWS CDK (VPC, RDS, ECS Fargate, ALB)
- ✅ Five provider kinds (airline, hotel, credit card, rail, shopping) with a 13-program catalog
- ✅ Balance history (synced + manual, backdatable), portfolio summary, batch sync
- ✅ Brand kit, landing page, dashboard, account detail with history sparkline

## Phase 1 — Portfolio intelligence

Make the data users already have more useful. All items are core + web changes with no new infrastructure.

| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | **Point valuations** | Editorial cents-per-point per provider; estimated USD value on summary, accounts, and dashboard |
| ✅ | **Balance deltas & trends** | Change vs. previous snapshot and 30/90-day baselines on account cards and detail pages; derived from existing snapshot history via `findTrendContextByAccountIds` |
| ✅ | **Expiration tracking** | Provider-level inactivity policy in the catalog; `expiresAt` on accounts; dashboard warnings for balances at risk |
| ✅ | **Points activity feed** | Append-only activity events (link, unlink, sync, manual, update); `GET /api/v1/activity` + dashboard feed |
| ✅ | **CSV / JSON export** | `GET /api/v1/export?format=json\|csv` dumps accounts + history; dashboard download buttons |
| ✅ | **Trip goals** | Target balances toward a trip; progress against linked program balances |
| ✅ | **CSV import** | `POST /api/v1/import` rehydrates accounts + balances from an export |
| ✅ | **iCal expirations** | `GET /api/v1/calendar.ics` for calendar apps |
| ✅ | **Account notes & tags** | Free-text note + tag set on accounts; dashboard tag filter |
| ✅ | **Pinned programs** | `pinnedAt` sorts favorites to the top of the dashboard |
| ✅ | **Demo portfolio** | `POST /api/v1/demo` seeds five programs + a Kyoto goal for empty accounts |
| ✅ | **Goal progress in digests** | Weekly email includes active goals + expiry callouts |
| ✅ | **Soft-delete / undo unlink** | 7-day restore window; `POST .../restore` + recently-unlinked UI |
| ✅ | **Public share link** | Privacy-preserving snapshot at `/share/{token}` (no membership numbers) |
| ✅ | **AI assistant** | Grounded chat (`LlmAssistant` port) — OpenAI-compatible or heuristic fallback |
| ✅ | **Deal scraping** | `PageScraper` port — Firecrawl or stub; extract + re-rank deals |
| ✅ | **Bang-for-buck advisor** | Transfer partner graph + curated/scraped deal ranking |
| 🔮 | **Custom valuations** | Let users override cents-per-point per program; adds a per-user settings table |

## Phase 2 — Automation & notifications

Move from on-demand to ambient. Powered by the background worker (`apps/worker`): EventBridge-scheduled Fargate tasks in AWS, `docker compose run worker` locally, with SES for delivery in production and Mailpit (OSS) for local email testing.

| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | **Scheduled syncs** | EventBridge cron (every 6h) → worker invoking `SyncAllLoyaltyAccounts` for every user with linked accounts |
| ✅ | **Email digests** | Weekly portfolio summary (balances + estimated value) via the `Mailer` port: SES in AWS, SMTP/Mailpit locally; recipients resolved from Clerk via the `UserDirectory` port |
| 🔜 | **Per-provider rate limiting** | Throttle sync fan-out per provider once real integrations land |
| 🔮 | **Alerts** | Balance drops, large posts, approaching expirations; per-user notification preferences |
| 🔮 | **Webhooks** | Signed `balance.updated` / `account.linked` events for third-party consumers |

## Phase 3 — Real provider integrations

Replace the simulated gateway with real adapters behind the existing `TravelProviderGateway` port. Each integration is an isolated infrastructure adapter; nothing above the port changes.

| Status | Feature | Notes |
| --- | --- | --- |
| 🔜 | **First-party APIs where available** | Amtrak, Bilt, and card programs with official/partner APIs first — most stable surface |
| 🔜 | **Aggregator adapter** | One adapter over a loyalty-data aggregator to cover the long tail quickly |
| 🔜 | **1Password Connect hardening** | Production deployment guide, secret rotation, health checks (adapter already exists) |
| 🔮 | **Device keychain flows** | Polished Apple Keychain / Chrome credential-manager UX feeding the existing one-time `transientCredential` path |
| 🔮 | **Resilience** | Circuit breakers, retry budgets, and per-provider status surfaced in sync outcomes |

## Phase 4 — Multi-surface

The API, contracts, and typed client were built for this; these are new consumer apps, not platform changes.

| Status | Feature | Notes |
| --- | --- | --- |
| 🔜 | **Mobile app (Expo)** | `apps/mobile` workspace using `@pointup/api-client` + `@clerk/clerk-expo`; dashboard and detail parity first |
| 🔜 | **Chrome extension** | `apps/extension` with `@clerk/chrome-extension`; reads balances from provider pages the user visits and records them as manual snapshots — sync without credentials |
| 🔮 | **OpenAPI document** | Generate from the zod contracts so third parties can integrate without the TypeScript client |

## Phase 5 — Optimization & redemption

The differentiating layer once balances, valuations, and integrations are solid.

| Status | Feature | Notes |
| --- | --- | --- |
| 🔮 | **Transfer partner graph** | Model card-currency → airline/hotel transfer ratios in the domain; "your Chase points are also 80k Hyatt points" |
| 🔮 | **Redemption recommendations** | Rank options by cents-per-point realized, powered by the valuation model + partner graph |
| 🔮 | **Household pooling** | Shared portfolio views across Clerk organization members |

## Cross-cutting engineering track

Continuous work alongside the phases:

- **Observability** — CloudWatch alarms for ALB 5xx and service CPU shipped; next: OpenTelemetry traces through use cases, structured logs, dashboards
- **CI/CD** — shipped: keyless OIDC deploys from GitHub Actions on every master push, with post-deploy migrations as a one-off Fargate task
- **E2E tests** — Playwright against a seeded Postgres + Clerk test instance in CI
- **API versioning policy** — additive changes within `v1`; contract-diff check in CI
- **Audit log** — append-only record of credential-ref changes and unlinks (partially covered by the activity feed)
- **Rate limiting** — per-user token bucket at the ALB/route layer before public launch

## Brainstorm — candidates for later phases

Ideas ranked by how well they fit the current architecture (ports already exist, or a thin new port would unlock them). Not committed — pick from here when sequencing the next sprint. Status markers: ✅ shipped this round.

### High leverage (thin slices on existing core)

| Status | Idea | Why it fits |
| --- | --- | --- |
| ✅ | **Goals / trip targets** | "Save 80k Hyatt for Kyoto" — goal entity + progress against current balances |
| ✅ | **Import from CSV** | Inverse of export; reuses `LinkLoyaltyAccount` + `RecordManualBalance` |
| ✅ | **iCal feed of expirations** | `GET /api/v1/calendar.ics` from existing expiry data |
| ✅ | **Account notes & tags** | Free-text note + tag set; dashboard filter chips |
| ✅ | **Demo / sample portfolio** | Seed use case + empty-state CTA |
| ✅ | **Goal progress in digests** | Weekly email appends goal % + expiry warnings |
| ✅ | **Pinned / favorite programs** | `pinnedAt` on account; sort dashboard |
| ✅ | **Soft-delete / undo unlink** | Tombstone + 7-day restore window |
| ✅ | **Public share link** | Tokenized snapshot of totals (no membership numbers) |
| ✅ | **AI assistant** | `LlmAssistant` port + grounded portfolio chat panel |
| ✅ | **Firecrawl / page scrape** | `PageScraper` port; ingest award charts into deal ranking |
| ✅ | **Transfer graph + BFB ranking** | Catalog edges + `GetValueAdvice` / Value & deals UI |
| 🔜 | **Multi-currency valuations** | FX port + display currency preference; cents-per-point stays USD-denominated internally |
| 🔜 | **Bulk edit membership numbers** | PATCH many accounts from one form; reuse `UpdateLoyaltyAccount` |
| 🔜 | **Award watchlist alerts** | Persist scraped routes; notify via Mailer when space/value improves |

### Product differentiators (need new domain models)

| Idea | Notes |
| --- | --- |
| **Transfer partner graph** | Card currency → airline/hotel ratios; "your Chase is also 80k Hyatt" (Phase 5) |
| **Transfer-bonus calendar** | Time-boxed ratio overrides on the partner graph |
| **"What can I book?"** | Rank redemptions by realized cpp given current balances + partner graph |
| **Award watchlist / seat alerts** | Watch a route+date; notify when award space opens (needs a scraper/API adapter + alert channel) |
| **Earn-rate calculator** | Catalog of card earn categories; "this purchase is worth X points" |
| **Household / shared portfolios** | Clerk Organizations + shared read models (Phase 5) |
| **Dynamic valuations** | Pull The Points Guy / community cpp feeds via a `ValuationSource` port |
| **Burn vs. earn advisor** | Given a purchase, recommend pay-cash vs. redeem vs. transfer |
| **Status tracker** | Elite-qualifying nights/segments/spend toward the next tier |
| **Credit card wallet** | Annual fees, AF reminders, product-change calendar alongside UR/MR balances |

### Surface & distribution

| Idea | Notes |
| --- | --- |
| **Expo mobile app** | Phase 4 — dashboard/detail parity first |
| **Chrome extension auto-capture** | Read balances from provider pages the user visits; post as manual snapshots (Phase 4) |
| **Public share link** | Privacy-preserving snapshot of totals (no membership numbers) for "look what I have" — ✅ shipped |
| **Slack / Discord digests** | New `Notifier` port alongside `Mailer`; weekly digest already exists |
| **OpenAPI from zod** | Generate from contracts so third parties don't need the TS client |
| **Widget / embed** | Tiny iframe of portfolio value for personal sites |
| **Siri / App Intents** | "How many Hyatt points do I have?" via the mobile surface |
| **PWA install + offline cache** | Service worker over the existing App Router |

### Ops, trust & growth

| Idea | Notes |
| --- | --- |
| **Per-user notification preferences** | Quiet hours, channels, which event types |
| **Accessibility & i18n pass** | WCAG audit; extract copy for locales |
| **Playwright e2e in CI** | Seeded Postgres + Clerk test instance |
| **Referral / invite codes** | Growth loop once multi-user is sticky |
| **Data residency / export-on-delete** | GDPR-shaped account wipe that still emits the export |
| **Feature flags** | LaunchDarkly-style or simple env flags for gradual rollouts |
| **Cost-to-serve dashboard** | Per-user sync volume + SES spend for ops |