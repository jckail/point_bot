import { UserId } from "@pointup/core";
import { createHash } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { authorizationUrl, createTransaction, OPENAI_ISSUER, tokenRequest, TRANSACTION_TTL_MS, validateCallback, verifyIdentity } from "./oidc";

const discovery = { issuer: OPENAI_ISSUER, authorization_endpoint: `${OPENAI_ISSUER}/api/accounts/authorize`, token_endpoint: `${OPENAI_ISSUER}/api/accounts/oauth/token`, jwks_uri: `${OPENAI_ISSUER}/.well-known/jwks.json` };
const config = { clientId: "oaiapp_test", redirectUri: "https://pointup.test/api/auth/chatgpt/callback", authenticationMethod: "none" as const };
const callback = (state: string) => new URL(`${config.redirectUri}?state=${state}&code=test-code`);

describe("ChatGPT authorization transaction", () => {
  it("generates independent state/nonce/verifiers and the matching S256 challenge", () => {
    const first = createTransaction(UserId.parse("user_a"), config.redirectUri, 100);
    const second = createTransaction(UserId.parse("user_a"), config.redirectUri, 100);
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.codeChallenge).toBe(createHash("sha256").update(first.codeVerifier).digest("base64url"));
    expect(first.expiresAt).toBe(100 + TRANSACTION_TTL_MS);
    const url = new URL(authorizationUrl(discovery, config, first));
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });
  it("rejects missing/reused, mismatched, expired, or different-user transactions", () => {
    const tx = createTransaction(UserId.parse("user_a"), config.redirectUri, 100);
    expect(() => validateCallback(null, callback(tx.state), UserId.parse("user_a"), 101)).toThrow();
    expect(() => validateCallback(tx, callback("bad"), UserId.parse("user_a"), 101)).toThrow();
    expect(() => validateCallback(tx, callback(tx.state), UserId.parse("user_a"), tx.expiresAt)).toThrow();
    expect(() => validateCallback(tx, callback(tx.state), UserId.parse("user_b"), 101)).toThrow();
    expect(() => validateCallback(tx, callback(tx.state), null, 101)).toThrow();
    expect(validateCallback(tx, callback(tx.state), UserId.parse("user_a"), 101).code).toBe("test-code");
  });
  it("rejects denial, missing code and ambiguous callback parameters", () => {
    const tx = createTransaction(UserId.parse("user_a"), config.redirectUri);
    for (const suffix of ["&error=access_denied", "&state=duplicate", "&code=duplicate"]) {
      expect(() => validateCallback(tx, new URL(callback(tx.state).toString() + suffix), UserId.parse("user_a"))).toThrow();
    }
    expect(() => validateCallback(tx, new URL(`${config.redirectUri}?state=${tx.state}`), UserId.parse("user_a"))).toThrow();
  });
  it("exchanges using original verifier/callback and correct client authentication", () => {
    const tx = createTransaction(UserId.parse("user_a"), config.redirectUri);
    const request = tokenRequest(config, "code", tx);
    const body = request.body as URLSearchParams;
    expect(request.redirect).toBe("error");
    expect(body.get("code_verifier")).toBe(tx.codeVerifier);
    expect(body.get("redirect_uri")).toBe(tx.redirectUri);
    expect(body.has("client_secret")).toBe(false);
    expect(request.headers).not.toHaveProperty("authorization");
    expect(() => tokenRequest({ ...config, authenticationMethod: "client_secret_basic" }, "code", tx)).toThrow();
    const confidential = tokenRequest({ ...config, authenticationMethod: "client_secret_basic", clientSecret: "secret +&" }, "code", tx);
    expect(confidential.headers).toHaveProperty("authorization", `Basic ${Buffer.from("oaiapp_test:secret+%2B%26").toString("base64")}`);
    expect((confidential.body as URLSearchParams).has("client_secret")).toBe(false);
  });
});

describe("ChatGPT ID token verification", () => {
  it("requires a trusted signature, issuer, audience, expiration and nonce", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const keySet = createLocalJWKSet({ keys: [{ ...jwk, kid: "trusted", alg: "RS256" }] });
    const makeToken = (changes: Record<string, unknown> = {}) => new SignJWT({ nonce: "expected", sub: "subject_1", iss: OPENAI_ISSUER, aud: config.clientId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...changes }).setProtectedHeader({ alg: "RS256", kid: "trusted" }).sign(privateKey);
    expect(await verifyIdentity(await makeToken(), "expected", config.clientId, discovery, keySet)).toEqual({ issuer: OPENAI_ISSUER, clientId: config.clientId, subject: "subject_1" });
    for (const changes of [{ iss: "https://attacker.test" }, { aud: "another-client" }, { exp: 1 }, { nonce: "bad" }, { sub: "" }]) {
      await expect(verifyIdentity(await makeToken(changes), "expected", config.clientId, discovery, keySet)).rejects.toThrow();
    }
    const untrusted = await generateKeyPair("RS256");
    const forged = await new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "RS256", kid: "trusted" }).setSubject("subject_1").setIssuer(OPENAI_ISSUER).setAudience(config.clientId).setIssuedAt().setExpirationTime("1h").sign(untrusted.privateKey);
    await expect(verifyIdentity(forged, "expected", config.clientId, discovery, keySet)).rejects.toThrow();
  });
});
