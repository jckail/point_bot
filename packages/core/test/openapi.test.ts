import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentObservationDtoSchema, submitAgentObservationRequestSchema } from "../src/contracts/agents";
import { assistantActionProposalRequestSchema } from "../src/domain/assistant/actions";

import { buildOpenApiDocument } from "../src/contracts/openapi";

// Minimal shape assertions — enough to catch a broken generator without
// pinning the whole document.
interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
}

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument() as unknown as OpenApiDoc;

  it("is a valid OpenAPI 3.1 document with info", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("PointUp API");
    expect(doc.info.version).toBe("1.0.0");
  });

  it("documents the core endpoints", () => {
    for (const path of [
      "/api/health",
      "/api/v1/providers",
      "/api/v1/summary",
      "/api/v1/loyalty-accounts",
      "/api/v1/loyalty-accounts/{id}",
      "/api/v1/goals",
      "/api/v1/assistant/chat",
      "/api/v1/value-advice",
    ]) {
      expect(doc.paths[path], `missing path ${path}`).toBeDefined();
    }
    // The bulk-edit endpoint (added recently) is present as a PATCH collection op.
    expect(doc.paths["/api/v1/loyalty-accounts"]!.patch).toBeDefined();
  });

  it("documents history and balance mutation wire responses", () => {
    const balances = doc.paths["/api/v1/loyalty-accounts/{id}/balances"]!;
    expect(balances.get).toBeDefined();
    const schemaAt = (operation: unknown, status: string) => {
      const op = operation as { responses: Record<string, { content: Record<string, { schema: unknown }> }> };
      return op.responses[status]!.content["application/json"]!.schema;
    };
    expect(schemaAt(balances.get, "200")).toEqual({ type: "array", items: { $ref: "#/components/schemas/BalanceDto" } });
    expect(schemaAt(balances.post, "201")).toEqual({ $ref: "#/components/schemas/BalanceDto" });
    expect(schemaAt(doc.paths["/api/v1/loyalty-accounts/{id}/sync"]!.post, "200")).toEqual({ $ref: "#/components/schemas/BalanceDto" });
  });

  it("registers component schemas generated from the contracts", () => {
    for (const name of [
      "LoyaltyAccountDto",
      "PortfolioSummaryDto",
      "ProviderDto",
      "BulkUpdateMembershipRequest",
      "ApiError",
    ]) {
      expect(doc.components.schemas[name], `missing schema ${name}`).toBeDefined();
    }
    // Generated schemas must not leak the JSON Schema dialect marker.
    for (const schema of Object.values(doc.components.schemas)) {
      expect((schema as Record<string, unknown>).$schema).toBeUndefined();
    }
  });

  it("marks public endpoints as security-free and defaults others to auth", () => {
    expect((doc.paths["/api/v1/providers"]!.get as { security: unknown[] }).security).toEqual([]);
    expect(doc.components.securitySchemes.clerkSession).toBeDefined();
  });

  it("references components rather than inlining everything at the top level", () => {
    const providers = doc.paths["/api/v1/providers"]!.get as {
      responses: { "200": { content: Record<string, { schema: { items: { $ref: string } } }> } };
    };
    expect(providers.responses["200"].content["application/json"]!.schema.items.$ref).toBe(
      "#/components/schemas/ProviderDto",
    );
  });
});

interface Operation {
  operationId: string;
  security: Record<string, unknown[]>[];
  responses: Record<string, { content: Record<string, { schema: unknown }> }>;
  requestBody?: { content: Record<string, { schema: unknown }> };
  "x-pointup-required-scopes"?: string[];
  "x-pointup-browser-session-only"?: boolean;
}

describe("agent and staged action OpenAPI authority", () => {
  const doc = buildOpenApiDocument() as unknown as OpenApiDoc;
  const op = (path: string, method: string) => doc.paths[`/api/v1/${path}`]![method] as Operation;
  const response = (operation: Operation, status: string) => operation.responses[status]!.content["application/json"]!.schema;

  it("documents metadata and exact response envelopes from shared contracts", () => {
    expect(response(op("agents/tokens", "get"), "200")).toEqual({ type: "array", items: { $ref: "#/components/schemas/AgentTokenDto" } });
    expect(response(op("agents/tokens", "post"), "201")).toEqual({ $ref: "#/components/schemas/MintAgentTokenResponse" });
    expect(response(op("agents/consents", "post"), "201")).toEqual({ $ref: "#/components/schemas/AgentConsentDto" });
    for (const status of ["200", "202"]) expect(response(op("agents/observations", "post"), status)).toEqual({ $ref: "#/components/schemas/AgentObservationDto" });
    expect(response(op("assistant/actions", "get"), "200")).toEqual({ $ref: "#/components/schemas/AssistantActionsResponse" });
    expect(response(op("assistant/actions", "post"), "201")).toEqual({ $ref: "#/components/schemas/AssistantActionResponse" });
    const properties = (doc.components.schemas.AgentConsentDto as { properties: Record<string, unknown> }).properties;
    expect(properties.userId).toBeUndefined();
    const tokenProperties = (doc.components.schemas.AgentTokenDto as { properties: Record<string, unknown> }).properties;
    expect(tokenProperties.tokenHash).toBeUndefined();
  });

  it("uses shared request input and DTO output schemas without tightening defaulted input", () => {
    for (const [name, source, io] of [
      ["SubmitAgentObservationRequest", submitAgentObservationRequestSchema, "input"],
      ["AgentObservationDto", agentObservationDtoSchema, "output"],
      ["AssistantActionProposalRequest", assistantActionProposalRequestSchema, "input"],
    ] as const) {
      const generated = z.toJSONSchema(source, { target: "draft-2020-12", io });
      delete generated.$schema;
      expect(doc.components.schemas[name]).toEqual(generated);
    }
    const input = doc.components.schemas.SubmitAgentObservationRequest as { required: string[] };
    const output = doc.components.schemas.AgentObservationDto as { required: string[] };
    expect(input.required).not.toContain("sourceMethod");
    expect(output.required).toContain("sourceMethod");
  });

  it("restricts management, reviews and raw balance mutations to cookie sessions", () => {
    for (const [path, method] of [["agents/tokens", "get"], ["agents/tokens", "post"], ["agents/tokens/{id}", "delete"], ["agents/consents", "post"], ["agents/consents/{id}", "delete"], ["agents/observations", "get"], ["agents/observations/{id}/review", "post"], ["assistant/actions", "get"], ["assistant/actions/{actionId}/approve", "post"], ["assistant/actions/{actionId}/reject", "post"], ["loyalty-accounts/{id}/balances", "post"], ["loyalty-accounts/{id}/sync", "post"], ["sync", "post"], ["import", "post"], ["demo", "post"], ["shares", "post"]]) {
      const operation = op(path!, method!);
      expect(operation.security, `${method} ${path}`).toEqual([{ clerkCookie: [] }]);
      expect(operation["x-pointup-browser-session-only"]).toBe(true);
    }
  });

  it("requires scoped PAT observations and permits proposals without granting execution authority", () => {
    expect(op("agents/observations", "post").security).toEqual([{ agentToken: [] }]);
    expect(op("agents/observations", "post")["x-pointup-required-scopes"]).toEqual(["observations:write"]);
    expect(op("assistant/actions", "post")["x-pointup-required-scopes"]).toEqual(["actions:propose"]);
    expect(op("assistant/chat", "post")["x-pointup-required-scopes"]).toEqual(["assistant:chat"]);
    expect(op("goals", "post")["x-pointup-required-scopes"]).toEqual(["portfolio:write"]);
    expect(op("goals/{id}", "patch")["x-pointup-required-scopes"]).toEqual(["portfolio:write"]);
    expect(op("assistant/actions/{actionId}/approve", "post").requestBody?.content["application/json"]!.schema).toEqual({ $ref: "#/components/schemas/AssistantActionDecisionRequest" });
  });

  it("provides unique stable operation IDs and resolves every local component reference", () => {
    const operations = Object.values(doc.paths).flatMap(item => Object.entries(item).filter(([method]) => ["get", "post", "patch", "put", "delete"].includes(method)).map(([, operation]) => operation as Operation));
    const ids = operations.map(operation => operation.operationId);
    expect(ids.every(id => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(op("agents/observations", "post").operationId).toBe("submitAgentObservation");
    expect(op("assistant/actions", "post").operationId).toBe("proposeAssistantAction");
    for (const match of JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"/]+)"/g)) expect(doc.components.schemas[match[1]!], `unresolved ${match[1]}`).toBeDefined();
  });
});
