import { UserId } from "@pointup/core";
import { afterEach, expect, it, vi } from "vitest";
import { getGlobalTraceProvider, setTraceProcessors, setTracingDisabled } from "@openai/agents";
import { runPortfolioAssistant, type AgentUseCases } from "../index";
import { assistantConfig } from "../config";

afterEach(() => {
  vi.restoreAllMocks();
  setTracingDisabled(true);
  setTraceProcessors([]);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("bootstraps the private exporter before concurrent live-model paths and sanitizes actual ingestion payloads", async () => {
  const payloads: unknown[] = [];
  const requests: string[] = [];
  vi.stubEnv("OPENAI_API_KEY", "SYNTHETIC_NO_NETWORK_KEY");
  vi.stubEnv("OPENAI_AGENTS_DISABLE_TRACING", "0");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url.endsWith("/traces/ingest")) {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }
    expect(url).toBe("https://api.openai.com/v1/responses");
    return new Response(JSON.stringify({ error: { message: "PRIVATE_BOOTSTRAP_FAILURE_CANARY", type: "invalid_request_error" } }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }));
  setTracingDisabled(false);
  const provider = getGlobalTraceProvider();
  const replacements = vi.spyOn(provider, "setProcessors");
  const config = assistantConfig({ ASSISTANT_RUNTIME: "agents", OPENAI_API_KEY: "SYNTHETIC_NO_NETWORK_KEY",
    ASSISTANT_MODEL: "synthetic-model", ASSISTANT_TRACING_ENABLED: "true" });
  const outcomes = await Promise.allSettled(["synthetic-first", "synthetic-second"].map(requestId => runPortfolioAssistant({
    userId: UserId.parse("PRIVATE_OWNER_CANARY"), body: { message: "PRIVATE_CHAT_CANARY" }, useCases: {} as AgentUseCases, config, requestId, observe: () => {},
  })));
  for (const outcome of outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ code: "ASSISTANT_UNAVAILABLE" });
  }
  expect(replacements).toHaveBeenCalledTimes(1);
  await provider.forceFlush();
  expect(requests.filter(url => url.endsWith("/responses"))).toHaveLength(2);
  expect(payloads.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(payloads);
  expect(serialized).not.toContain("synthetic-first");
  expect(serialized).not.toContain("synthetic-second");
  expect(serialized).toContain("Assistant operation failed");
  expect(serialized).toContain("operation_failed");
  expect(serialized).not.toMatch(/PRIVATE_|SYNTHETIC_NO_NETWORK_KEY/);
  replacements.mockRestore();
});
