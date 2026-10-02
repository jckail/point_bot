import { describe, expect, it } from "vitest";
import { chatAssistantResponseSchema } from "../src/contracts/index";
import { buildOpenApiDocument } from "../src/contracts/openapi";
import { buildChatGptSpec, isAgentActionOperation } from "../../../plugins/chatgpt/build";

describe("reviewed assistant wire contracts", () => {
  it("retains complete immutable proposals in chat responses", () => {
    const action = {
      id: "proposal", kind: "manual_balance", status: "pending", title: "Record balance", summary: "Review first",
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-01T00:15:00.000Z",
      result: null, failureCode: null,
      payload: { accountId: "owned-account", providerId: "program", providerName: "Program", points: 2000, capturedAt: "2026-10-01T00:00:00.000Z" },
    };
    expect(chatAssistantResponseSchema.parse({ reply: "Please review", actions: [action] })).toEqual({ reply: "Please review", actions: [action] });
    expect(chatAssistantResponseSchema.parse({ reply: "Advice" })).toEqual({ reply: "Advice" });
    expect(chatAssistantResponseSchema.safeParse({ reply: "Review", actions: [{ ...action, payload: { ...action.payload, points: -1 } }] }).success).toBe(false);
  });

  it("documents browser decisions with cookie authority and immutable empty bodies", () => {
    const doc = buildOpenApiDocument();
    const paths = doc.paths as Record<string, { post: Record<string, unknown> }>;
    for (const decision of ["approve", "reject"]) {
      const operation = paths[`/api/v1/assistant/actions/{actionId}/${decision}`]!.post;
      expect(operation.security).toEqual([{ browserSession: [] }]);
      expect(operation["x-pointup-session-only"]).toBe(true);
      expect(operation.requestBody).toMatchObject({ required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AssistantActionReviewRequest" } } } });
    }
  });

  it("exports proposal tools while retaining PR14 tools and excluding browser decisions", () => {
    const spec = buildChatGptSpec("https://pointup.example");
    const operations = Object.values(spec.paths as Record<string, Record<string, unknown>>).flatMap(item =>
      Object.entries(item).filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method)).map(([, operation]) => operation as Record<string, unknown>),
    );
    const ids = operations.map(operation => operation.operationId);
    expect(ids).toEqual(expect.arrayContaining(["chatWithAssistant", "listAssistantActions", "proposeAssistantAction", "recordBalance", "createGoal"]));
    expect(ids).not.toEqual(expect.arrayContaining(["approveAssistantAction"]));
    expect(ids).not.toEqual(expect.arrayContaining(["rejectAssistantAction"]));
    for (const browserOnly of ["grantConsent", "confirmObservationReview", "rejectObservationReview", "listAccessTokens", "createAccessToken", "revokeAccessToken"]) {
      expect(ids).not.toContain(browserOnly);
    }
    expect(operations.length).toBeLessThanOrEqual(30);
    expect(operations.every(isAgentActionOperation)).toBe(true);
    expect(operations.find(operation => operation.operationId === "proposeAssistantAction")?.["x-openai-isConsequential"]).toBe(true);
    expect(spec.security).toEqual([{ accessToken: [] }]);
  });

  it("rejects browser-only operations independently of the allow list", () => {
    expect(isAgentActionOperation({ "x-pointup-session-only": true })).toBe(false);
    expect(isAgentActionOperation({ security: [{ browserSession: [] }] })).toBe(false);
    expect(isAgentActionOperation({ security: [{ accessToken: [] }] })).toBe(true);
  });
});
