import { RunContext } from "@openai/agents";
import { UserId } from "@pointup/core";
import { describe, expect, it, vi } from "vitest";
import { createPortfolioTools } from "../tools";
import type { AgentUseCases } from "../use-cases";
import type { Observation } from "../observation";

function fixture(signal: AbortSignal) {
  const queries = {
    getPortfolioSummary: vi.fn(), listLoyaltyAccounts: vi.fn(),
    listTripGoals: vi.fn(), getValueAdvice: vi.fn(), chatWithAssistant: vi.fn(),
  };
  const useCases = {
    getPortfolioSummary: { execute: queries.getPortfolioSummary },
    listLoyaltyAccounts: { execute: queries.listLoyaltyAccounts },
    listTripGoals: { execute: queries.listTripGoals },
    getValueAdvice: { execute: queries.getValueAdvice },
    chatWithAssistant: { execute: queries.chatWithAssistant },
  } satisfies AgentUseCases;
  const events: Omit<Observation, "requestId" | "mode" | "sdkTraceId">[] = [];
  const tools = createPortfolioTools(useCases, UserId.parse("synthetic-tool-owner"), signal, event => events.push(event));
  return { queries, events, tools };
}

const safeResult = "An error occurred while running the tool. Please try again. Error: Error: Portfolio data could not be loaded.";

describe("SDK tool cancellation boundary", () => {
  it.each([new Error("SYNTHETIC_PRIVATE_ABORT_REASON"), "SYNTHETIC_PRIVATE_ABORT_REASON"])(
    "observes pre-aborted read tools without querying or exporting the abort reason (%s)", async reason => {
      const controller = new AbortController();
      controller.abort(reason);
      const f = fixture(controller.signal);
      for (const target of f.tools) {
        // Real installed SDK invocation: default tool error handling returns a
        // model-visible string, rather than rejecting with our fixed Error.
        const result = await target.invoke(new RunContext(), "{}");
        expect(result).toBe(safeResult);
        expect(result).not.toContain("SYNTHETIC_PRIVATE");
        expect(f.events.filter(event => event.tool === target.name)).toEqual([
          { event: "tool_completed", tool: target.name, status: "cancelled", durationMs: expect.any(Number) },
        ]);
      }
      expect(f.events).toHaveLength(f.tools.length);
      expect(f.events.every(event => typeof event.durationMs === "number" && Number.isFinite(event.durationMs) && event.durationMs >= 0)).toBe(true);
      expect(JSON.stringify(f.events)).not.toContain("SYNTHETIC_PRIVATE");
      for (const query of Object.values(f.queries)) expect(query).not.toHaveBeenCalled();
    },
  );

  it("preserves fixed SDK-visible errors and one failed event for an ordinary private query failure", async () => {
    const f = fixture(new AbortController().signal);
    f.queries.getPortfolioSummary.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_BODY"));
    const target = f.tools.find(tool => tool.name === "portfolio_summary");
    if (!target) throw new Error("Missing portfolio tool");
    expect(await target.invoke(new RunContext(), "{}")).toBe(safeResult);
    expect(f.queries.getPortfolioSummary).toHaveBeenCalledOnce();
    expect(f.events).toEqual([
      { event: "tool_completed", tool: "portfolio_summary", status: "failed", durationMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(f.events)).not.toContain("SYNTHETIC_PRIVATE");
  });
});
