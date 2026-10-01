import { PointUpClient } from "@pointup/api-client";
import { describe, expect, it } from "vitest";

import { extractBalance } from "../src/extraction";
import { recordCapture } from "../src/record";

function setup(respond: (path: string, body?: unknown) => { status?: number; json: unknown }) {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = [];
  const api = new PointUpClient({
    baseUrl: "https://pointup.test",
    headers: { Authorization: "Bearer pu_x" },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: init?.method ?? "GET", path, body });
      const { status = 200, json } = respond(path, body);
      return new Response(JSON.stringify(json), { status });
    }),
  });
  return { api, calls };
}

const capture = extractBalance({
  url: "https://www.united.com/en/us/myunited?token=secret#frag",
  text: "You have 48,320 miles",
})!;

describe("recordCapture", () => {
  it("captures a query-free source URL", () => {
    expect(capture.sourceUrl).toBe("https://www.united.com/en/us/myunited");
  });

  it("uses the consented agent endpoint for pu_ tokens", async () => {
    const { api, calls } = setup(() => ({
      status: 201,
      json: { outcome: "recorded", accountId: "a", points: 48320, previousPoints: 1, message: "Recorded 48,320." },
    }));
    const result = await recordCapture(api, "pu_abc", capture);
    expect(result).toEqual({ ok: true, message: "Recorded 48,320." });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/agent/observations",
      body: { skillId: "united.capture-balance", points: 48320, agent: "pointup-extension" },
    });
  });

  it("explains missing consent clearly", async () => {
    const { api } = setup(() => ({
      status: 403,
      json: { error: { code: "CONSENT_REQUIRED", message: "no consent" } },
    }));
    const result = await recordCapture(api, "pu_abc", capture);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/consent.*Dashboard > Agents/i);
  });

  it("reports held-for-review outcomes as not recorded", async () => {
    const { api } = setup(() => ({
      json: { outcome: "needs_review", accountId: "a", points: 9, previousPoints: 1, message: "Looks high." },
    }));
    const result = await recordCapture(api, "pu_abc", capture);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Dashboard > Agents/);
  });

  it("keeps the session-token path for non-pu_ tokens", async () => {
    const { api, calls } = setup((path) =>
      path.endsWith("loyalty-accounts")
        ? { json: [{ id: "acc1", provider: { id: "united", displayName: "United" } }] }
        : { json: {} },
    );
    const result = await recordCapture(api, "clerk_session", capture);
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.path)).not.toContain("/api/v1/agent/observations");
  });
});
