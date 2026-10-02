import { PointUpClient } from "@pointup/api-client";
import { describe, expect, it } from "vitest";
import { recordCapture } from "../src/record";
import type { ReviewedCapture } from "../src/capture-state";

const capture: ReviewedCapture = {
  captureId: "00000000-0000-4000-8000-000000000001", observedAt: "2026-10-02T00:00:00.000Z",
  sourceMethod: "page_capture", providerId: "united", points: 123,
  sourceUrl: "https://www.united.com/en/us/myunited",
};
function apiFailure(options: { status?: number; code?: string; bodyReference?: unknown; headerReference?: string; manual?: boolean } = {}) {
  return new PointUpClient({ baseUrl: "https://synthetic.example", fetch: async (input) => {
    if (options.manual && String(input).endsWith("loyalty-accounts")) {
      return Response.json([{ id: "fixture-account", provider: { id: "united", displayName: "United" } }]);
    }
    return Response.json({ error: { code: options.code ?? "PRIVATE_CODE_TOKEN_SECRET", message: "private provider message password=secret stacktrace", ...(options.bodyReference !== undefined ? { requestId: options.bodyReference } : {}) } },
      { status: options.status ?? 500, headers: options.headerReference ? { "x-request-id": options.headerReference } : {} });
  } });
}

describe("capture failure diagnostics", () => {
  it.each([
    { bodyReference: "00000000-0000-4000-8000-000000000002" },
    { headerReference: "request.fixture-2026:10_02" },
  ])("preserves safe body/header correlation with fixed wording", async (options) => {
    const result = await recordCapture(apiFailure(options), "pu_fixture", capture);
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain(`Support reference: ${options.bodyReference ?? options.headerReference}.`);
    expect(result.message).not.toMatch(/private|password|stacktrace|PRIVATE_CODE/);
  });
  it.each([undefined, "short", "bad <script>secret</script>", "\nrequest-injection", "x".repeat(129), 123, { private: "secret" }])(
    "omits malformed or absent references: %j", async (bodyReference) => {
      const result = await recordCapture(apiFailure({ bodyReference }), "pu_fixture", capture);
      expect(result.message).not.toContain("Support reference:");
      expect(result.message).not.toMatch(/secret|private|script|injection/);
    },
  );
  it.each([401, 403])("distinguishes PAT/session authorization guidance for HTTP %i", async (status) => {
    const pat = await recordCapture(apiFailure({ status }), "pu_fixture", capture);
    const session = await recordCapture(apiFailure({ status, manual: true }), "clerk_fixture", capture);
    expect(pat.message).toContain("observations:write");
    expect(session.message).toContain("Sign in to PointUp again");
    expect(session.message).not.toContain("observations:write");
    expect(pat.message + session.message).not.toMatch(/private|PRIVATE_CODE|secret/);
  });
  it.each(["CONSENT_REQUIRED", "SKILL_NOT_FOUND", "OBSERVATION_REPLAY_CONFLICT"])("preserves reference on supported %s failure", async (code) => {
    const result = await recordCapture(apiFailure({ status: 403, code, bodyReference: "support-fixture" }), "pu_fixture", capture);
    expect(result.message).toContain("Support reference: support-fixture.");
    expect(result.message).not.toContain("private provider");
  });
  it("preserves correlation on the manual write failure after a successful account lookup", async () => {
    const result = await recordCapture(apiFailure({ manual: true, headerReference: "manual-request-fixture" }), "clerk_fixture", capture);
    expect(result.message).toContain("Support reference: manual-request-fixture.");
    expect(result.message).toContain("before repeating a manual balance write");
  });
  it("never exposes unexpected network error details and distinguishes uncertain timeout writes", async () => {
    const network = new PointUpClient({ baseUrl: "https://synthetic.example", fetch: async () => { throw new Error("private token=secret"); } });
    expect((await recordCapture(network, "pu_fixture", capture)).message).not.toMatch(/private|secret/);
    const timeout = new PointUpClient({ baseUrl: "https://synthetic.example", fetch: async () => { throw new DOMException("private token=secret", "TimeoutError"); } });
    expect((await recordCapture(timeout, "pu_fixture", capture)).message).toContain("same review");
    expect((await recordCapture(timeout, "clerk_fixture", capture)).message).toContain("before repeating a manual balance write");
  });
});
