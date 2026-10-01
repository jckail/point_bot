import { type AccessToken, AccessTokenId, type AccessTokenScope, assertDevAuthAllowed, assertValidDevToken, hashToken, TOKEN_PREFIX, UserId } from "@pointup/core";

import type { WorkerContainer } from "../container";
import type { WorkerEnv } from "../env";
import { runMigrations } from "./migrate";

/** Least-privilege scopes for the local dev token: never consents:manage. */
export const DEV_TOKEN_SCOPES: readonly AccessTokenScope[] = [
  "portfolio:read",
  "portfolio:write",
  "observations:write",
];
export const DEV_TOKEN_NAME = "Dev bootstrap token";
const DEV_TOKEN_ID = AccessTokenId.parse("dev-bootstrap-token");

export interface BootstrapOutcome {
  readonly seeded: boolean;
  readonly tokenMinted: boolean;
}

/**
 * One-shot local bootstrap: migrate, then (dev auth mode only) seed the dev
 * user's demo portfolio and mint a deterministic personal access token so the
 * MCP server / plugins work with zero clicks. Idempotent: safe to run on every
 * `docker compose up`.
 */
export async function bootstrap(
  env: WorkerEnv,
  makeContainer: () => WorkerContainer,
): Promise<BootstrapOutcome> {
  await runMigrations(env.DATABASE_URL);

  if (env.AUTH_PROVIDER !== "dev") {
    if (env.POINTUP_DEV_TOKEN) {
      throw new Error(
        "POINTUP_DEV_TOKEN is only allowed with AUTH_PROVIDER=dev; refusing to mint a fixed token",
      );
    }
    console.info("[bootstrap] AUTH_PROVIDER is not dev: migrations only");
    return { seeded: false, tokenMinted: false };
  }

  assertDevAuthAllowed({
    provider: "dev",
    nodeEnv: env.NODE_ENV,
    allowInsecureDevAuth: env.ALLOW_INSECURE_DEV_AUTH,
    bindHost: undefined,
    loopbackOnlyAttested: env.DEV_AUTH_HOST_IS_LOOPBACK_ONLY,
  });

  const container = makeContainer();
  const userId = UserId.parse(env.DEV_USER_ID);

  let seeded = false;
  if ((await container.accounts.findByUserId(userId)).length === 0) {
    await container.useCases.seedDemoPortfolio.execute(userId);
    seeded = true;
    console.info(`[bootstrap] seeded demo portfolio for ${userId}`);
  } else {
    console.info(`[bootstrap] ${userId} already has accounts; seed skipped`);
  }

  let tokenMinted = false;
  if (env.POINTUP_DEV_TOKEN) {
    assertValidDevToken(env.POINTUP_DEV_TOKEN);
    tokenMinted = await ensureDevToken(
      container,
      userId,
      env.POINTUP_DEV_TOKEN,
    );
    printConnectionSnippets(env, env.POINTUP_DEV_TOKEN);
  } else {
    console.info(
      "[bootstrap] POINTUP_DEV_TOKEN not set: no token minted (create one at /dashboard/agents)",
    );
  }
  return { seeded, tokenMinted };
}

/** Upserts the dev token by hash; revokes older bootstrap tokens with other values. */
async function ensureDevToken(
  container: WorkerContainer,
  userId: UserId,
  plaintext: string,
): Promise<boolean> {
  const tokenHash = await hashToken(plaintext);
  const now = new Date();
  const existingForUser = await container.accessTokens.findByUserId(userId);

  for (const old of existingForUser) {
    if (old.name === DEV_TOKEN_NAME && old.tokenHash !== tokenHash && !old.revokedAt) {
      await container.accessTokens.update({ ...old, revokedAt: now });
    }
  }

  const current = await container.accessTokens.findByHash(tokenHash);
  const token: AccessToken = {
    id: current?.id ?? DEV_TOKEN_ID,
    userId,
    name: DEV_TOKEN_NAME,
    displayPrefix: plaintext.slice(0, TOKEN_PREFIX.length + 4),
    tokenHash,
    scopes: DEV_TOKEN_SCOPES,
    createdAt: current?.createdAt ?? now,
    expiresAt: null,
    lastUsedAt: current?.lastUsedAt ?? null,
    revokedAt: null,
  };
  if (current) {
    await container.accessTokens.update(token);
    return false;
  }
  await container.accessTokens.insert(token);
  return true;
}

function printConnectionSnippets(env: WorkerEnv, token: string): void {
  const mcp = env.PUBLIC_MCP_URL;
  const web = env.PUBLIC_WEB_URL;
  console.info(`
==================== PointUp local stack is ready ====================
Dashboard (no sign-in, dev user "${env.DEV_USER_ID}"): ${web}/dashboard
Agents page:                                           ${web}/dashboard/agents
Mail (Mailpit):                                        http://localhost:8025

Dev token scopes: ${DEV_TOKEN_SCOPES.join(", ")}  (consents are granted in the dashboard)

--- Claude Code (MCP over HTTP) ---
claude mcp add --transport http pointup ${mcp} \\
  --header "Authorization: Bearer ${token}"

--- Claude Code plugin (plugins/claude) ---
export POINTUP_MCP_URL=${mcp}
export POINTUP_TOKEN=${token}

--- Any MCP client (JSON) ---
{ "mcpServers": { "pointup": { "type": "http", "url": "${mcp}",
    "headers": { "Authorization": "Bearer ${token}" } } } }

--- ChatGPT Action ---
ChatGPT calls from the internet, so it cannot reach localhost. Expose the web app
with a tunnel you trust, import <public-url>/api/v1/openapi.json, choose
Authentication: API key -> Bearer, and paste the token above. See docs/agents.md.

--- curl ---
curl -H "Authorization: Bearer ${token}" ${web}/api/v1/summary
=======================================================================`);
}
