import { generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { describe, expect, it, vi } from "vitest";
import { verifyOAuthAccessToken, type OAuthAccessTokenConfig } from "./oauth-access-token";

const config: OAuthAccessTokenConfig = { enabled: true, issuer: "https://clerk.pointup.test",
  resource: "https://mcp.pointup.test/mcp", allowedClientIds: ["https://chatgpt.com/oauth/client.json"], jwtKey: "synthetic-key" };
const now = 2_000_000_000_000;
const claims = () => ({ iss: config.issuer, aud: config.resource, sub: "user_owner1",
  client_id: config.allowedClientIds?.[0], scp: ["portfolio:read"], iat: now / 1000 - 30, exp: now / 1000 + 60 });
const jwt = "synthetic.header.signature";

describe("disabled OAuth read principal", () => {
  it("defaults disabled and never invokes a verifier", async () => {
    const verifyJwt = vi.fn();
    await expect(verifyOAuthAccessToken(jwt, undefined, { verifyJwt })).rejects.toThrow("Access token is invalid, expired, or revoked");
    expect(verifyJwt).not.toHaveBeenCalled();
  });
  it.each(["oat_opaque", "pu_pat", "not-a-jwt", "a.b.c.extra", "a..c"])("rejects unsupported credentials before verification: %s", async token => {
    const verifyJwt = vi.fn();
    await expect(verifyOAuthAccessToken(token, config, { verifyJwt })).rejects.toThrow("Access token is invalid");
    expect(verifyJwt).not.toHaveBeenCalled();
  });
  it.each([
    { enabled: false }, { issuer: undefined }, { resource: undefined }, { resource: "http://mcp.pointup.test/mcp" },
    { issuer: "https://person:secret@clerk.pointup.test" }, { resource: "https://mcp.pointup.test/mcp?q=secret" },
    { resource: "https://mcp.pointup.test/mcp?" }, { resource: "https://mcp.pointup.test/mcp#" },
    { resource: "https://mcp.pointup.test/a/../mcp" },
    { allowedClientIds: [] }, { jwtKey: undefined },
  ])("refuses incomplete or unsafe configuration: %j", async override => {
    const verifyJwt = vi.fn();
    await expect(verifyOAuthAccessToken(jwt, { ...config, ...override }, { verifyJwt })).rejects.toThrow("Access token is invalid");
    expect(verifyJwt).not.toHaveBeenCalled();
  });
  it.each(["scope", "scp"])("returns only read authority from verified %s", async scopeField => {
    const payload = { ...claims(), scp: undefined, [scopeField]: scopeField === "scope"
      ? "portfolio:read portfolio:write observations:write" : ["portfolio:read", "portfolio:write", "observations:write"] };
    const verifyJwt = vi.fn().mockResolvedValue(payload);
    expect(await verifyOAuthAccessToken(jwt, config, { verifyJwt, now: () => now })).toEqual({
      credential: "clerk-oauth", userId: "user_owner1", scopes: ["portfolio:read"], issuer: config.issuer,
      resource: config.resource, clientId: config.allowedClientIds?.[0], expiresAt: now + 60_000 });
    expect(verifyJwt).toHaveBeenCalledWith(jwt, { audience: config.resource,
      headerType: ["at+jwt", "application/at+jwt"], clockSkewInMs: 0, jwtKey: "synthetic-key" });
  });
  it("accepts an explicit resource in a verified audience array", async () => {
    await expect(verifyOAuthAccessToken(jwt, config, { verifyJwt: async () => ({ ...claims(), aud: ["other-resource", config.resource] }), now: () => now }))
      .resolves.toMatchObject({ resource: config.resource });
  });
  it.each([
    { iss: undefined }, { iss: "https://foreign.test" }, { iss: `${config.issuer}/` },
    { aud: undefined }, { aud: [] }, { aud: "https://mcp.pointup.test" }, { aud: [config.resource, 1] },
    { sub: "" }, { sub: "org_owner" }, { sub: undefined }, { client_id: undefined }, { client_id: "foreign-client" },
    { exp: now / 1000 }, { exp: "future" }, { exp: Number.MAX_SAFE_INTEGER },
    { iat: undefined }, { iat: now / 1000 + 1 }, { nbf: now / 1000 + 1 },
    { scp: undefined }, { scp: ["portfolio:write"] }, { scp: ["openid", "email"] },
    { scp: "portfolio:read" }, { scp: ["portfolio:read", 1] }, { scope: "portfolio:write" },
  ])("rejects missing/conflicting/invalid verified authority: %j", async override => {
    await expect(verifyOAuthAccessToken(jwt, config, { verifyJwt: async () => ({ ...claims(), ...override }), now: () => now }))
      .rejects.toThrow("Access token is invalid, expired, or revoked");
  });
  it("checks expiry after a verifier wait and hides private errors", async () => {
    let clock = now;
    await expect(verifyOAuthAccessToken(jwt, config, { verifyJwt: async () => { clock += 60_000; return claims(); }, now: () => clock }))
      .rejects.toThrow("Access token is invalid");
    await expect(verifyOAuthAccessToken(jwt, config, { verifyJwt: async () => { throw new Error("private-token-claims"); } }))
      .rejects.toThrow("Access token is invalid, expired, or revoked");
  });
});

describe("production Clerk cryptographic verification", () => {
  it("verifies real signed OAuth JWTs offline and refuses session headers and bad signatures", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const key = await importPKCS8(pair.privateKey, "RS256");
    const liveConfig = { ...config, jwtKey: pair.publicKey };
    const sign = (typ: string, omitAudience = false, issuer = config.issuer!) => {
      let signed = new SignJWT({ client_id: config.allowedClientIds?.[0], scp: ["portfolio:read"] })
        .setProtectedHeader({ alg: "RS256", typ }).setSubject("user_owner1").setIssuer(issuer)
        .setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 1).setExpirationTime("2m");
      if (!omitAudience) signed = signed.setAudience(config.resource!);
      return signed.sign(key);
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      for (const typ of ["at+jwt", "application/at+jwt"]) {
        await expect(verifyOAuthAccessToken(await sign(typ), liveConfig)).resolves.toMatchObject({ credential: "clerk-oauth", scopes: ["portfolio:read"] });
      }
      await expect(verifyOAuthAccessToken(await sign("JWT"), liveConfig)).rejects.toThrow("Access token is invalid");
      await expect(verifyOAuthAccessToken(await sign("at+jwt", true), liveConfig)).rejects.toThrow("Access token is invalid");
      await expect(verifyOAuthAccessToken(await sign("at+jwt", false, "https://foreign.test"), liveConfig)).rejects.toThrow("Access token is invalid");
      const signed = await sign("at+jwt");
      const segments = signed.split(".");
      segments[2] = `${segments[2]?.startsWith("A") ? "B" : "A"}${segments[2]?.slice(1)}`;
      await expect(verifyOAuthAccessToken(segments.join("."), liveConfig)).rejects.toThrow("Access token is invalid");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
});
