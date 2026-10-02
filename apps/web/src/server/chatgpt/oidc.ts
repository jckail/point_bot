import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const OPENAI_ISSUER = "https://auth.openai.com";
export const TRANSACTION_TTL_MS = 10 * 60 * 1000;
export const TRANSACTION_COOKIE = "__Host-pointup-chatgpt";

export interface ChatGptConfig {
  clientId: string;
  redirectUri: string;
  authenticationMethod: "none" | "client_secret_basic";
  clientSecret?: string;
}
export interface SignInTransaction {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  redirectUri: string;
  userId: string;
  expiresAt: number;
}
export interface OpenAiDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export function createTransaction(userId: string, redirectUri: string, now = Date.now()): SignInTransaction {
  const codeVerifier = randomBytes(64).toString("base64url");
  return {
    state: randomBytes(32).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    redirectUri,
    userId,
    expiresAt: now + TRANSACTION_TTL_MS,
  };
}

export function validateCallback(transaction: SignInTransaction | null, callback: URL, userId: string | null, now = Date.now()) {
  const state = callback.searchParams.getAll("state");
  if (!transaction || transaction.expiresAt <= now || transaction.userId !== userId || state.length !== 1 || !equal(state[0]!, transaction.state)) {
    throw new Error("ChatGPT authorization could not be verified.");
  }
  const codes = callback.searchParams.getAll("code");
  if (callback.searchParams.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 4096) {
    throw new Error("ChatGPT authorization could not be completed.");
  }
  return { code: codes[0], transaction };
}

function equal(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authorizationUrl(discovery: OpenAiDiscovery, config: ChatGptConfig, transaction: SignInTransaction) {
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: transaction.redirectUri,
    response_type: "code", scope: "openid profile email", state: transaction.state,
    code_challenge: transaction.codeChallenge, code_challenge_method: "S256", nonce: transaction.nonce,
  }).toString();
  return url.toString();
}

export function tokenRequest(config: ChatGptConfig, code: string, transaction: SignInTransaction): RequestInit {
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
  if (config.authenticationMethod === "client_secret_basic") {
    if (!config.clientSecret) throw new Error("ChatGPT confidential client secret is missing.");
    const formEncode = (value: string) => new URLSearchParams({ value }).toString().slice(6);
    headers.authorization = `Basic ${Buffer.from(`${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`).toString("base64")}`;
  }
  return {
    method: "POST", redirect: "error", headers, cache: "no-store", signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code, redirect_uri: transaction.redirectUri, code_verifier: transaction.codeVerifier }),
  };
}

let discoveryPromise: Promise<OpenAiDiscovery> | undefined;
export function discoverOpenAi(): Promise<OpenAiDiscovery> {
  discoveryPromise ??= fetch(`${OPENAI_ISSUER}/.well-known/openid-configuration`, { redirect: "error", signal: AbortSignal.timeout(10_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error("ChatGPT discovery failed.");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("ChatGPT discovery is invalid.");
      const document = data as Record<string, unknown>;
      if (document.issuer !== OPENAI_ISSUER) throw new Error("ChatGPT issuer is invalid.");
      for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
        if (typeof document[key] !== "string") throw new Error("ChatGPT discovery endpoint is invalid.");
        const url = new URL(document[key]);
        if (url.origin !== OPENAI_ISSUER || url.username || url.password || url.hash) throw new Error("ChatGPT discovery endpoint is invalid.");
      }
      return document as unknown as OpenAiDiscovery;
    }).catch((error: unknown) => { discoveryPromise = undefined; throw error; });
  return discoveryPromise;
}

const keySets = new Map<string, JWTVerifyGetKey>();
export async function verifyIdentity(idToken: string, nonce: string, clientId: string, discovery: OpenAiDiscovery, testKey?: JWTVerifyGetKey) {
  let keys = testKey ?? keySets.get(discovery.jwks_uri);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(discovery.jwks_uri), { timeoutDuration: 10_000 });
    keySets.set(discovery.jwks_uri, keys);
  }
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: discovery.issuer, audience: clientId,
    requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5,
    algorithms: ["RS256", "ES256"],
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub) throw new Error("ChatGPT identity could not be verified.");
  return { issuer: discovery.issuer, clientId, subject: payload.sub };
}
