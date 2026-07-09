# Multi-surface strategy

PointUp is designed so the web app is just the first surface. Everything user-facing goes through two shared building blocks:

1. **The versioned HTTP API** (`/api/v1/...`) served by the web app, whose wire format is defined once in `@pointup/core/contracts` (zod schemas + DTO types).
2. **`@pointup/api-client`** — a typed, fetch-only client over that API. It has no DOM, Node, or framework dependencies beyond `fetch`, so it runs anywhere.

```ts
import { createPointUpClient } from "@pointup/api-client";

const client = createPointUpClient({
  baseUrl: "https://app.pointup.example",
  credentials: "include", // web: ride on the Clerk session cookie
});

const accounts = await client.listLoyaltyAccounts();
await client.syncLoyaltyAccount(accounts[0].id);
```

Errors surface as `PointUpApiError` with the stable machine-readable `code` from the domain layer (`DUPLICATE_LOYALTY_ACCOUNT`, `PROVIDER_NOT_SUPPORTED`, ...), so every surface maps failures to UX the same way.

## Adding a mobile app (React Native / Expo)

- Depend on `@pointup/api-client` (add the app under `apps/`, or publish the package if the app lives in another repo).
- Provide the platform `fetch` (built-in on RN ≥ 0.74 / Expo).
- **Credentials**: store loyalty-program credentials in the device keychain (Apple Keychain via `expo-secure-store` or Keychain Services). At sync time, read the credential locally and pass it as `transientCredential` — the server uses it once and never persists it:

```ts
await client.syncLoyaltyAccount(accountId, {
  transientCredential: { username, secret }, // read from Apple Keychain
});
```

## Adding a Chrome extension

- Call the API from the extension's background service worker with `@pointup/api-client`.
- Add the extension origin (`chrome-extension://<id>`) to a CORS allow-list on the API routes when you build this surface.
- **Credentials**: Chrome's password manager autofills into pages, not extensions; the practical pattern is either a content script that captures credentials the user enters on the provider's site (with explicit consent) or the extension's own storage. Either way, submit them as `transientCredential` at sync time.

## Authentication across surfaces

User management is [Clerk](https://clerk.com/), which ships first-party SDKs for every surface we plan to support:

| Surface | Mechanism |
| --- | --- |
| Web | `@clerk/nextjs` session cookie (already implemented) |
| Mobile | [`@clerk/clerk-expo`](https://clerk.com/docs/references/expo/overview) — sign in on device, attach the session token as a bearer header |
| Chrome extension | [`@clerk/chrome-extension`](https://clerk.com/docs/references/chrome-extension/overview) — same pattern from the background service worker |

The API's auth guard is centralized in `apps/web/src/server/http.ts` (`withAuthenticatedUser`), which resolves the Clerk user id from either the session cookie or a bearer token (Clerk's `auth()` handles both). Non-web surfaces pass the token via the client:

```ts
const client = createPointUpClient({
  baseUrl: "https://app.pointup.example",
  headers: { Authorization: `Bearer ${await getToken()}` }, // Clerk session token
});
```

Route handlers and use cases never change per surface — the user id stays an opaque string throughout the core.

## Sharing more code later

- **Contracts stay in `@pointup/core/contracts`** — the one place where request/response shapes change. Version breaking changes under a new path (`/api/v2/...`).
- **Business rules stay in `@pointup/core`** — if a surface ever needs to run logic locally (e.g. offline mobile), it can import the domain layer directly; it is dependency-free.
- **Publishing**: workspace packages currently ship TypeScript source (consumed via `transpilePackages`). To use them from a separate repo, add a `tsc` build that emits `dist/` + declarations and publish to a private registry.
