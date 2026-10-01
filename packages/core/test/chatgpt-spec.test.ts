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
});
