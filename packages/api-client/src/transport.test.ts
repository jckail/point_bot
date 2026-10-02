import { describe, expect, it, vi } from "vitest";
import { PointUpClient, PointUpApiError } from "./index";

describe("PointUp HTTP transport", () => {
  it.each(["http://example.com", "https://user:secret@example.com", "https://example.com?token=secret", "https://example.com#token", "file:///tmp/api"])("rejects unsafe server address %s", baseUrl => {
    expect(() => new PointUpClient({ baseUrl })).toThrow();
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "https://pointup.io"])("accepts server address %s", baseUrl => {
    expect(() => new PointUpClient({ baseUrl })).not.toThrow();
  });
  it("keeps authentication on the configured endpoint and refuses redirects for JSON and exports", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(new Response("csv"));
    const client = new PointUpClient({ baseUrl: "https://pointup.io/", headers: { Authorization: "Bearer test" }, fetch });
    await client.listLoyaltyAccounts();
    await client.exportPortfolio("csv");
    for (const call of fetch.mock.calls) {
      expect(call[0]).toMatch(/^https:\/\/pointup.io\/api\/v1\//);
      expect(call[1]?.redirect).toBe("error");
      expect(call[1]?.headers).toMatchObject({ Authorization: "Bearer test" });
    }
  });
  it("encodes path segments rather than permitting account IDs to change the route", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({}));
    await new PointUpClient({ baseUrl: "https://pointup.io", fetch }).getLoyaltyAccount("a/b?c#d");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://pointup.io/api/v1/loyalty-accounts/a%2Fb%3Fc%23d");
  });
  it("reports API errors and handles empty delete responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new PointUpClient({ baseUrl: "https://pointup.io", fetch });
    await expect(client.listLoyaltyAccounts()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED", name: "PointUpApiError" });
    await expect(client.unlinkLoyaltyAccount("a")).resolves.toBeUndefined();
    expect(PointUpApiError).toBeDefined();
  });
});
