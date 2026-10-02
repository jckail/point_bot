import { createPointUpClient } from "@pointup/api-client";
import { z } from "zod";

const configSchema = z.object({
  POINTUP_API_URL: z.string().url(),
  POINTUP_SESSION_TOKEN: z.string().min(1).max(16_384).regex(/^[^\s]+$/).optional(),
  POINTUP_AGENT_TOKEN: z.string().min(1).max(16_384).regex(/^pu_[^\s]+$/).optional(),
  POINTUP_ALLOW_WRITES: z.enum(["true", "false"]).default("false"),
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  // Never print validation input: it contains the user's session token.
  if (!result.success || Boolean(result.data.POINTUP_AGENT_TOKEN) === Boolean(result.data.POINTUP_SESSION_TOKEN)) throw new Error("Set POINTUP_API_URL and exactly one POINTUP_AGENT_TOKEN or POINTUP_SESSION_TOKEN; POINTUP_ALLOW_WRITES must be true or false.");
  const url = new URL(result.data.POINTUP_API_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("POINTUP_API_URL must be an origin without credentials, path, query, or fragment.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("POINTUP_API_URL requires HTTPS except on loopback.");
  }
  return {
    baseUrl: url.origin,
    sessionToken: (result.data.POINTUP_AGENT_TOKEN ?? result.data.POINTUP_SESSION_TOKEN)!,
    allowWrites: result.data.POINTUP_ALLOW_WRITES === "true",
  };
}

export function clientFromConfig(config: ReturnType<typeof loadConfig>) {
  return createPointUpClient({
    baseUrl: config.baseUrl,
    headers: { Authorization: `Bearer ${config.sessionToken}` },
    timeoutMs: 15_000,
    // Do not forward the session token to a redirect destination.
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
}
