import { describe, expect, it } from "vitest";

import { buildChatGptSpec } from "../../../plugins/chatgpt/build";

describe("ChatGPT Action spec", () => {
  const spec = buildChatGptSpec("https://app.example.com") as {
    servers: { url: string }[];
    paths: Record<string, Record<string, { operationId?: string; "x-openai-isConsequential"?: boolean }>>;
  };
  const ops = Object.values(spec.paths).flatMap((p) =>
    Object.entries(p).filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m)),
  );

  it("stays within ChatGPT's 30-operation limit and has unique operationIds", () => {
    expect(ops.length).toBeLessThanOrEqual(30);
    const ids = ops.map(([, op]) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never exposes token minting or consent granting, and marks writes consequential", () => {
    expect(spec.paths["/api/v1/tokens"]).toBeUndefined();
    expect(spec.paths["/api/v1/consents"]?.post).toBeUndefined();
    for (const [method, op] of ops) {
      expect(op["x-openai-isConsequential"]).toBe(method !== "get");
    }
    expect(spec.servers[0]?.url).toBe("https://app.example.com");
  });

  it("keeps summaries and info within ChatGPT's 300-char limit and declares bearer auth", () => {
    const full = spec as unknown as {
      openapi: string;
      info: { title: string; description?: string };
      components?: { securitySchemes?: Record<string, { type: string; scheme?: string }> };
      paths: Record<string, Record<string, { summary?: string; description?: string }>>;
    };
    expect(full.openapi).toMatch(/^3\./);
    expect(full.info.title).toBe("PointUp");
    expect((full.info.description ?? "").length).toBeLessThanOrEqual(300);
    for (const item of Object.values(full.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        expect((op.summary ?? "").length).toBeLessThanOrEqual(300);
        expect((op.description ?? "").length).toBeLessThanOrEqual(300);
      }
    }
    const schemes = Object.values(full.components?.securitySchemes ?? {});
    expect(schemes.some((x) => x.type === "http" && x.scheme === "bearer")).toBe(true);
  });

  it("exposes the consented write-back path but never token or consent mutation", () => {
    expect(spec.paths["/api/v1/agent/observations"]?.post?.operationId).toBe("submitObservation");
    expect(Object.keys(spec.paths).some((p) => /\/tokens|\/consents\/.+/.test(p))).toBe(false);
  });
});
