import { PointUpClient } from "@pointup/api-client";
import { describe, expect, it } from "vitest";

import { pageCandidate } from "../src/capture-state";
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

const capture = pageCandidate(null, extractBalance({
  url: "https://www.united.com/en/us/myunited?token=secret#frag",
  text: "You have 48,320 miles",
})!, () => "00000000-0000-4000-8000-000000000001", () => new Date("2026-10-02T01:00:00.000Z"));

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
    expect(result).toMatchObject({ ok: true, outcome: "recorded", message: "Recorded 48,320." });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/agent/observations",
      body: { skillId: "united.capture-balance", points: 48320, agent: "pointup-extension", captureId: capture.captureId, observedAt: capture.observedAt, sourceMethod: "page_capture" },
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
  it("finishes unchanged observations as successful receipts", async () => {
    const { api } = setup(() => ({ json: { outcome: "unchanged", accountId: "a", points: 48320,
      previousPoints: 48320, message: "Already current", reviewId: null, observationId: "receipt_unchanged" } }));
    expect(await recordCapture(api, "pu_abc", capture)).toMatchObject({ ok: true, outcome: "unchanged", observationId: "receipt_unchanged" });
  });

  it("reports held-for-review outcomes as not recorded", async () => {
    const { api } = setup(() => ({
      json: { outcome: "needs_review", accountId: "a", points: 9, previousPoints: 1, message: "Looks high." },
    }));
    const result = await recordCapture(api, "pu_abc", capture);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Dashboard > Agents/);
  });

  it("retains identical payload and server review receipt across retries", async () => {
    const { api, calls } = setup(() => ({ json: { outcome: "needs_review", accountId: "a", points: 48320, previousPoints: 1, message: "Held", reviewId: "review_1", observationId: "receipt_1" } }));
    const first = await recordCapture(api, "pu_abc", capture);
    const retry = await recordCapture(api, "pu_abc", capture);
    expect(calls[0]?.body).toEqual(calls[1]?.body);
    expect(first).toMatchObject({ ok: false, outcome: "needs_review", reviewId: "review_1", observationId: "receipt_1" });
    expect(retry).toEqual(first);
  });
  it("reports rejected observations and replay conflicts without replacing the key", async () => {
    const { api, calls } = setup(() => ({ json: { outcome: "rejected", accountId: "a", points: 48320, previousPoints: 1, message: "Rejected", reviewId: null, observationId: "receipt_1" } }));
    expect(await recordCapture(api, "pu_abc", capture)).toMatchObject({ ok: false, outcome: "rejected", observationId: "receipt_1" });
    const conflict = setup(() => ({ status: 409, json: { error: { code: "OBSERVATION_REPLAY_CONFLICT", message: "changed" } } }));
    expect((await recordCapture(conflict.api, "pu_abc", capture)).message).toContain("conflicts");
    expect(conflict.calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ captureId: capture.captureId });
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
