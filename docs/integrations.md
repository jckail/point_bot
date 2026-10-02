# Integrations

Two integration families are designed in from the start: **loyalty providers** (airlines, hotels, credit card reward programs, rail, shopping portals) and **credential vaults** (1Password, Apple Keychain, Chrome's password manager). Both are modeled as application-layer ports with infrastructure adapters, so adding an integration never touches business logic.

## Loyalty providers (airlines, hotels, credit cards, and more)

### How it works

- The **catalog** of supported programs lives in the domain layer (`packages/core/src/domain/loyalty/provider.ts`): United, Delta, American, Marriott, Hilton, Hyatt out of the box.
- The **`TravelProviderGateway` port** (`packages/core/src/application/ports.ts`) is the integration seam:

```ts
interface TravelProviderGateway {
  supports(providerId: string): boolean;
  fetchBalance(
    account: LoyaltyAccount,
    credential: ProviderCredential | null,
  ): Promise<ProviderBalance>;
}
```

- The **`CompositeTravelProviderGateway`** routes each sync to the first registered gateway that supports the provider. `SimulatedTravelProviderGateway` currently handles every cataloged provider with deterministic fake balances for development.

### Adding a real provider integration

1. Add the program to the catalog if it isn't there (one line).
2. Write an adapter in `packages/core/src/infrastructure/providers/`, e.g. `UnitedGateway implements TravelProviderGateway`, calling the airline's API (or an aggregator such as an NDC/loyalty API vendor).
3. Register it in the shared `buildTravelProviderGateway()` factory (`packages/core/src/infrastructure/providers/build-gateway.ts`, used by both web and worker), or compose real adapters directly:

```ts
const gateway = new CompositeTravelProviderGateway([
  new UnitedGateway(unitedApiOptions),
]);
```

No use case, route, or schema changes are required — this is the open/closed principle at work. Balance history accumulates automatically because syncs append `balance_snapshot` rows.

### Shipped: the aggregator gateway

`HttpAggregatorTravelProviderGateway` is a real adapter for a loyalty-data
aggregator's HTTP API — one integration to cover the long tail of programs. It's
composed by the shared `buildTravelProviderGateway()` factory (used by both the
web app and the worker), which registers the aggregator when it's configured:

```ts
const gateway = buildTravelProviderGateway({
  aggregator:
    env.AGGREGATOR_API_URL && env.AGGREGATOR_API_KEY
      ? { baseUrl: env.AGGREGATOR_API_URL, apiKey: env.AGGREGATOR_API_KEY }
      : undefined,
});
```

Set `AGGREGATOR_API_URL` + `AGGREGATOR_API_KEY` (locally, or via CDK context
`-c enableAggregator=true -c aggregatorApiUrl=…` in AWS — the key becomes a
Secrets Manager placeholder) and sync attempts route through it. Configuration
does not prove vendor authorization or live provider coverage. Unconfigured or
unsupported real providers remain unavailable rather than replacing observed
balances with fake values. The vendor wire contract is:

```
POST {baseUrl}/v1/balance
Authorization: Bearer {apiKey}
{ "providerId", "membershipNumber", "credential"?: { "username", "secret" } }
→ 200 { "points": number }
```

Transient credentials the calling surface supplies are forwarded for one-time
use and never persisted. `supportedProviderIds` scopes the adapter to the
programs a given vendor actually covers.

### Explicit demo mode and truthful capabilities

The factory defaults to no simulated gateway. `allowSimulation:true` is an
explicit demo-only option; shared web/worker composition enables it only under
the existing `AUTH_PROVIDER=dev` context. Normal Clerk or omitted authentication
configuration cannot silently simulate a sync. A real adapter failure also does
not fall back to demo success. Unavailable sync leaves history, account metadata,
activity and outbox unchanged.

The dashboard distinguishes configured API sync, demo sync and unavailable sync.
Unavailable programs link to manual recording and consented capture rather than
offering an ordinary sync button. These capability labels represent configured
adapters, not verified vendor connectivity. Official provider partnerships and
live capture still need separate evidence.

Previous simulated snapshots used the same sync source as real adapters. Do not
delete or automatically reassign historical rows from that label alone. Before
production activation, inspect actual deployment history and data, identify any
affected balances using reliable evidence and agree on reviewed repair/recovery.
This source fix prevents new implicit simulation; it does not repair old rows.

## Credential vaults

PointUp **never stores raw provider passwords**. A loyalty account carries at most a `credentialRef` — an opaque pointer into a vault the user controls. At sync time the credential is resolved, used once in memory, and discarded.

Two resolution paths cover all vault types:

### 1. Server-resolvable vaults (1Password)

`OnePasswordConnectVault` implements the `CredentialVault` port against a self-hosted [1Password Connect](https://developer.1password.com/docs/connect/) server. Configure it with:

```bash
OP_CONNECT_HOST="https://op-connect.internal:8080"
OP_CONNECT_TOKEN="..."
```

Credential refs use the format `op://<vaultId>/<itemId>`. When these env vars are unset, the composition root falls back to `NullCredentialVault`.

To support another server-side vault (e.g. HashiCorp Vault, AWS Secrets Manager per-user secrets), implement `CredentialVault` and swap it in the composition root.

### 2. Device-bound vaults (Apple Keychain, Chrome password manager)

The API supports **transient credentials** supplied by an authorized client for one-time sync. This API capability does not establish a device vault integration. The current Chrome extension captures visible loyalty balances after consent; it does not collect provider passwords or read the browser password manager.

```
POST /api/v1/loyalty-accounts/{id}/sync
{ "transientCredential": { "username": "...", "secret": "..." } }
```

- **iOS/macOS app**: deferred. A future device vault integration needs its own credential lifecycle and client verification.
- **Chrome extension**: consented balance extraction and reviewed write-back are implemented. Device vault access and transient-credential submission are not implemented.

`SyncLoyaltyAccount` prefers a transient credential over a stored `credentialRef`, and never persists it. See `packages/core/src/application/loyalty/sync-loyalty-account.ts`.

### Precedence and failure behavior

| Situation | Behavior |
| --- | --- |
| Transient credential provided | Used, regardless of stored ref |
| Stored `credentialRef`, vault resolves it | Used |
| Stored `credentialRef`, vault cannot resolve | `409 CREDENTIAL_UNAVAILABLE` |
| No credential at all | Gateway is called with `null` (fine for providers/aggregators that only need the membership number) |

## AI assistant (`LlmAssistant`)

PointUp Assistant is a grounded chat over the user's portfolio. The application use case (`ChatWithAssistant`) assembles balances, trip goals, and transfer-value hints, then calls the **`LlmAssistant` port**:

```ts
interface LlmAssistant {
  complete(input: {
    system: string;
    messages: AssistantMessage[];
  }): Promise<string>;
}
```

Adapters:

| Adapter | When |
| --- | --- |
| `OpenAiCompatibleAssistant` | `LLM_API_KEY` set (OpenAI, Groq, Azure OpenAI, Ollama shim, …) |
| `HeuristicAssistant` | No key — deterministic advice from transfer hints in the system prompt |

Optional env: `LLM_API_KEY`, `LLM_MODEL` (default `gpt-4o-mini`), `LLM_BASE_URL`.

The assistant never receives credentials or vault secrets — only portfolio read models.

## Page scraping (`PageScraper`)

Deal and award-chart pages are fetched through the **`PageScraper` port** (Firecrawl-shaped):

```ts
interface PageScraper {
  scrape(url: string): Promise<ScrapedPage>; // url, title, markdown
}
```

| Adapter | When |
| --- | --- |
| `FirecrawlPageScraper` | `FIRECRAWL_API_KEY` set ([Firecrawl](https://docs.firecrawl.dev)) |
| `StubPageScraper` | No key — returns demo markdown for Hyatt/United/Hilton URLs |

`IngestDealPage` parses point/cash pairs from markdown and feeds them into `GetValueAdvice` ranking. Optional env: `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`.

## Transfer graph & bang-for-buck

Editorial transfer edges live in `packages/core/src/domain/loyalty/transfer-partners.ts` (Chase/Amex/Cap One/Citi/Bilt → airline/hotel partners, plus real, time-boxed **transfer bonuses** stored in the `transfer_bonus` table - empty by default, see [optimizer.md](optimizer.md)). `GetValueAdvice` ranks transfers by effective cents-per-point and scores curated + scraped deals against what the user holds. Dashboard: **Value & deals** + floating **Ask PointUp** assistant.

## Award availability (`AwardAvailabilitySource`)

The redemption optimizer attaches real award space to flight plans only through this port (`searchAwards(origin, destination, dateFrom, dateTo, cabin)`):

| Adapter | When |
| --- | --- |
| `HttpAwardAvailabilitySource` | `AWARD_SEARCH_API_URL` **and** `AWARD_SEARCH_API_KEY` set |
| `StubAwardAvailabilitySource` | Otherwise - returns `status: "not_configured"` and no options |

HTTP contract (our own; put a gateway in front of your data vendor): `GET {AWARD_SEARCH_API_URL}/awards?origin=&destination=&from=&to=&cabin=` with `Authorization: Bearer <key>`, returning `{ "options": [{ "program", "carrier?", "date", "cabin", "points", "taxes_cents?", "seats?" }] }`. Failures never throw; they surface as `status: "error"`. See [optimizer.md](optimizer.md).

## Upstream transport and capture boundaries

Firecrawl, the legacy OpenAI-compatible assistant and HTTP award search require
HTTPS upstreams, with HTTP allowed only on loopback for explicit local fixtures.
Configured base URLs cannot contain userinfo, query, fragment, whitespace or
backslashes. Requests refuse redirects; provider error bodies and original
exceptions are not copied into public guidance. Responses are bounded before
parsing (1MiB scraper,256KiB assistant/award); unavailable results do not establish
verified award availability. Production CDK also validates scraper/LLM URLs.

Slack/Discord webhook path/query tokens remain supported with HTTPS or explicit
loopback HTTP. Redirects are disabled, response bodies are discarded, and failure
diagnostics omit token-bearing URLs and notification content.

The Chrome extractor requires balance context or an isolated unit reading, strict
integer grouping and a unique value. It refuses conflicting/promotional readings
and partial decimal, negative or exponent suffixes. This is conservative synthetic
fixture coverage, not live provider-page verification. Seven airline/hotel rules
remain; Chase, Amex, Capital One and Bilt have unverified core playbooks but no
extension extraction rules, manifest matches or card fixtures. Expand these only
with program-specific balance labels, approved hosts, negative offer fixtures and
separate live consented validation.
