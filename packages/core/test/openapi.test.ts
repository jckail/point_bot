import { describe, expect, it } from "vitest";

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
