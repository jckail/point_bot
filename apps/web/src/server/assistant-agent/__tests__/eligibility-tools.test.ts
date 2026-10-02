import { describe, expect, it, vi } from "vitest";
import { UserId } from "@pointup/core";
import type { AgentUseCases } from "../use-cases";
vi.mock("@openai/agents", () => ({ tool: (definition: unknown) => definition }));
import { createPortfolioTools } from "../tools";

describe("assistant eligibility grounding transport", () => {
  it("retains excluded-transfer guidance in the tool output", async () => {
    const warning = { code: "CARD_PRODUCT_REQUIRED", fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt", cardProductId: null, message: "Select your transfer card before estimating a Hyatt transfer." };
    const useCases = { getValueAdvice: { execute: vi.fn().mockResolvedValue({ transfers: [], deals: [], eligibilityWarnings: [warning] }) } } as unknown as AgentUseCases;
    const tools = createPortfolioTools(useCases, UserId.parse("synthetic-owner"), new AbortController().signal, () => undefined);
    const advice = tools.find(tool => tool.name === "value_advice") as unknown as { execute: () => Promise<string> };
    expect(JSON.parse(await advice.execute())).toEqual({ transfers: [], deals: [], eligibilityWarnings: [warning] });
  });
});
