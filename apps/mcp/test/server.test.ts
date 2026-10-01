import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPointUpClient } from "@pointup/api-client";
import { describe, expect, it } from "vitest";

import { createPointUpMcpServer } from "../src/server";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  auth?: string;
}

async function connect(
  respond: (call: Call) => { status?: number; json?: unknown },
  clientCaps: Record<string, unknown> = {},
) {
  const calls: Call[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init?.headers as Record<string, string>)?.Authorization,
    };
    calls.push(call);
    const { status = 200, json } = respond(call);
    return new Response(status === 204 ? null : JSON.stringify(json ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const server = createPointUpMcpServer({
    client: createPointUpClient({
      baseUrl: "https://pointup.test",
      fetch: fakeFetch,
      headers: { Authorization: "Bearer pu_test" },
    }),
    appUrl: "https://pointup.test",
    agentName: "vitest",
  });
  const client = new Client({ name: "t", version: "1" }, { capabilities: clientCaps });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, calls };
}

const text = (r: unknown) =>
  ((r as { content: { text: string }[] }).content[0] as { text: string }).text;

describe("pointup MCP server", () => {
  it("exposes read, write, and agent tools plus prompts", async () => {
    const { client } = await connect(() => ({ json: [] }));
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const expected of [
      "pointup_get_portfolio_summary",
      "pointup_list_accounts",
      "pointup_link_account",
      "pointup_list_skills",
      "pointup_request_consent",
      "pointup_submit_balance",
    ]) {
      expect(names).toContain(expected);
    }
    // Consent management is never a blind tool: no direct grant/revoke tool.
    expect(names.some((n) => /grant_consent|revoke/.test(n))).toBe(false);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["capture-balance", "portfolio-review"]));
  });

  it("forwards the caller's token and marks read tools read-only", async () => {
    const { client, calls } = await connect(() => ({ json: { totalPoints: 1 } }));
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "pointup_list_accounts")?.annotations?.readOnlyHint).toBe(true);
    await client.callTool({ name: "pointup_get_portfolio_summary", arguments: {} });
    expect(calls[0]).toMatchObject({ path: "/api/v1/summary", auth: "Bearer pu_test" });
  });

  it("stamps submissions with the agent name and surfaces API errors as tool errors", async () => {
    const { client, calls } = await connect(() => ({
      status: 403,
      json: { error: { code: "CONSENT_REQUIRED", message: "No active consent" } },
    }));
    const result = await client.callTool({
      name: "pointup_submit_balance",
      arguments: {
        skillId: "united.capture-balance",
        points: 100,
        sourceUrl: "https://www.united.com/x",
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("CONSENT_REQUIRED");
    expect(calls[0]?.body).toMatchObject({ agent: "vitest", points: 100 });
  });

  it("does not grant consent when the client cannot prompt the user", async () => {
    const { client, calls } = await connect(() => ({ json: {} }));
    const result = await client.callTool({
      name: "pointup_request_consent",
      arguments: { providerId: "united" },
    });
    expect(JSON.parse(text(result))).toMatchObject({ granted: false });
    expect(calls).toHaveLength(0);
  });

  it("grants consent only after the user accepts the elicitation", async () => {
    for (const [action, approve, expectGrant] of [
      ["accept", true, true],
      ["accept", false, false],
      ["decline", false, false],
    ] as const) {
      const { client, calls } = await connect(
        () => ({ status: 201, json: { id: "c1", providerId: "united", active: true } }),
        { elicitation: {} },
      );
      const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
      client.setRequestHandler(ElicitRequestSchema, async () => ({
        action,
        content: { approve },
      }));
      const result = await client.callTool({
        name: "pointup_request_consent",
        arguments: { providerId: "united", days: 7 },
      });
      expect(JSON.parse(text(result)).granted).toBe(expectGrant);
      expect(calls.some((c) => c.path === "/api/v1/consents")).toBe(expectGrant);
    }
  });

  it("builds the capture-balance playbook from the skill catalog", async () => {
    const { client } = await connect(() => ({
      json: [
        {
          id: "united.capture-balance",
          mode: "browser",
          title: "Read your United balance",
          startUrl: "https://www.united.com/",
          allowedHosts: ["united.com"],
          accountLinked: true,
          consentActive: false,
          extraction: { field: "points", hint: "miles" },
          steps: ["Open the page"],
        },
      ],
    }));
    const prompt = await client.getPrompt({
      name: "capture-balance",
      arguments: { providerId: "united" },
    });
    const body = (prompt.messages[0]?.content as { text: string }).text;
    expect(body).toContain("united.capture-balance");
    expect(body).toContain("pointup_request_consent");
  });
});
