# @pointup/api-client

Typed HTTP client for the PointUp v1 API. Depends only on `fetch` and the wire contracts from `@pointup/core/contracts`, so it runs on every surface: web, React Native / Expo, and browser extensions.

```ts
import { createPointUpClient } from "@pointup/api-client";

const client = createPointUpClient({
  baseUrl: "http://localhost:3000",
  credentials: "include",
});

const providers = await client.listProviders();
```

See [docs/multi-surface.md](../../docs/multi-surface.md) for surface-specific guidance (auth, keychain-backed transient credentials, CORS).
