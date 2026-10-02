import { describe, expect, it } from "vitest";
import { Usage, type Model, type ModelRequest, type AgentOutputItem } from "@openai/agents";
import { runPortfolioAssistant, type Observation } from "../index";
import { assistantConfig } from "../config";
import { evaluationCases } from "../evaluation/cases";
import { createEvaluationFixture, privateCanaries, syntheticOwner } from "../evaluation/fixture";
import { flushEvaluationTraces, runEvaluationCase, runEvaluationSuite, scoreEvaluation } from "../evaluation/run";

const config = assistantConfig({ ASSISTANT_RUNTIME: "agents", ASSISTANT_MODEL: "injected", OPENAI_API_KEY: "no-network" });
const text = (reply: string): AgentOutputItem => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: reply }] });
const call = (name: string, args: object = {}, id = name): AgentOutputItem => ({ type: "function_call", name, callId: id, arguments: JSON.stringify(args) });
function script(outputs: AgentOutputItem[][]) {
  const requests: ModelRequest[] = [];
  const model: Model = {
    async getResponse(request) {
      requests.push(request);
      const output = outputs[requests.length - 1];
      if (!output) throw new Error("Unexpected model turn");
      return { output, usage: new Usage({ requests: 1, inputTokens: 11, outputTokens: 7, totalTokens: 18 }) };
    },
    async *getStreamedResponse() { throw new Error("Streaming not used"); },
  };
  return { model, requests };
}
async function run(outputs: AgentOutputItem[][], variant?: "empty" | "injection", authority = true) {
  const fixture = createEvaluationFixture({ variant });
  const sdk = script(outputs);
  const events: Observation[] = [];
  const result = await runPortfolioAssistant({ userId: syntheticOwner, body: { message: "Synthetic evaluation" }, config, model: sdk.model, useCases: fixture.useCases, actions: authority ? fixture.actions : undefined, observe: event => events.push(event) });
  return { ...sdk, fixture, result, events };
}

describe("synthetic portfolio evaluation contracts", () => {
  it("exposes grounding, stale observations, goal progress and valuations through actual SDK tool results without private fields", async () => {
    const execution = await run([[call("portfolio_summary"), call("loyalty_balances"), call("trip_goals"), call("value_advice")], [text("Synthetic result")]]);
    const toolContext = JSON.stringify(execution.requests[1]?.input);
    expect(toolContext).toContain("90000");
    expect(toolContext).toContain("117000");
    expect(toolContext).toContain("2025-01-01T00:00:00.000Z");
    expect(toolContext).toContain("remainingPoints");
    expect(toolContext).toContain("30000");
    expect(toolContext).toContain("synthetic_northstar");
    for (const secret of privateCanaries) expect(toolContext).not.toContain(secret);
    expect(toolContext).not.toContain("hasCredentials");
    expect(execution.fixture.reads.sort()).toEqual(["loyalty_balances", "portfolio_summary", "trip_goals", "value_advice"]);
    expect(execution.fixture.attemptedOwners.every(owner => owner === syntheticOwner)).toBe(true);
    expect(execution.requests[0]?.modelSettings).toMatchObject({ store: false, maxTokens: 1200 });
    // This verifies what the real SDK receives, not that a scripted model follows it.
    const policy = execution.requests[0]?.systemInstructions;
    expect(policy).toContain("Read current portfolio tools");
    expect(policy).toContain("untrusted data");
    expect(policy).toContain("stale balances");
    expect(policy).toContain("live award availability");
    expect(policy).toContain("MFA codes");
    expect(policy).toContain("approve or reject");
  });

  it("keeps malicious provider content in data and preserves application authority boundaries", async () => {
    const execution = await run([[call("value_advice")], [text("Tokyo is an editorial estimate; provider instructions are untrusted.")]], "injection");
    expect(JSON.stringify(execution.requests[1]?.input)).toContain("UNTRUSTED PROVIDER PAGE");
    expect(execution.requests[1]?.systemInstructions).not.toContain("INJECTION_APPROVED");
    expect(execution.fixture.persisted).toHaveLength(0);
    const names = execution.requests[0]?.tools.map(tool => tool.name);
    expect(names).not.toContain("approve");
    expect(names).not.toContain("book");
    expect(JSON.stringify(execution.events)).not.toContain("UNTRUSTED PROVIDER PAGE");
  });

  it("persists exact reviewed values once, exposes review requirement and never invokes a mutation", async () => {
    const testCase = evaluationCases.find(item => item.id === "reviewed-balance")!;
    const execution = await run([[call("loyalty_balances")], [call("propose_manual_balance", { accountId: "synthetic_northstar", points: 42000, capturedAt: "2026-09-30T12:00:00Z" })], [text("Review 42,000 points in settings and approve the proposal.")]]);
    expect(execution.fixture.persisted).toHaveLength(1);
    expect(execution.fixture.persisted[0]).toMatchObject({ status: "pending", payload: { accountId: "synthetic_northstar", points: 42000, capturedAt: "2026-09-30T12:00:00Z" }, result: null });
    expect(JSON.stringify(execution.requests[2]?.input)).toContain("requiresBrowserApproval");
    expect(execution.result.actions).toEqual(execution.fixture.persisted);
    expect(scoreEvaluation(testCase, execution.result.reply, execution.fixture, execution.events).every(check => check.passed)).toBe(true);
  });

  it("rejects foreign account IDs through an owner-enforcing proposal service", async () => {
    const execution = await run([[call("propose_manual_balance", { accountId: "foreign_account", points: 999, capturedAt: null })], [text("I cannot access another user's accounts.")]]);
    expect(execution.fixture.persisted).toHaveLength(0);
    expect(execution.events).toContainEqual(expect.objectContaining({ event: "tool_completed", tool: "propose_manual_balance", status: "failed" }));
    expect(JSON.stringify(execution.requests[1]?.input)).toContain("Portfolio data could not be loaded");
    expect(JSON.stringify(execution.requests[1]?.input)).not.toContain("Synthetic ownership rejection");
  });

  it("rejects model-injected owner fields before an account proposal can persist", async () => {
    const execution = await run([[call("propose_manual_balance", { userId: "another-owner", accountId: "synthetic_northstar", points: 999, capturedAt: null })], [text("I cannot change the owner scope.")]]);
    expect(execution.fixture.persisted).toHaveLength(0);
    expect(execution.fixture.attemptedOwners).toHaveLength(0);
  });

  it("bounds persistent proposals even when the model asks for six in one tool turn", async () => {
    const execution = await run([Array.from({ length: 6 }, (_, i) => call("propose_trip_goal", { title: `Synthetic goal ${i}`, targetPoints: 1000, targetDate: null, accountIds: [], notes: null }, `proposal_${i}`)), [text("Review the pending proposals in settings.")]]);
    expect(execution.fixture.persisted).toHaveLength(5);
    expect(execution.result.actions).toHaveLength(5);
    expect(execution.fixture.persisted.every(action => action.status === "pending")).toBe(true);
  });

  it("does not turn empty accounts or goals into invented observations", async () => {
    const execution = await run([[call("loyalty_balances"), call("trip_goals")], [text("No accounts or goals are available.")]], "empty");
    expect(JSON.stringify(execution.requests[1]?.input)).toContain('totalAccounts');
    expect(JSON.stringify(execution.requests[1]?.input)).toContain('totalGoals');
    expect(JSON.stringify(execution.requests[1]?.input)).not.toContain("40000");
    expect(execution.fixture.reads).toEqual(["loyalty_balances", "trip_goals"]);
  });

  it("returns sanitized machine-readable usage rather than prompts, replies, payloads or provider failures", async () => {
    const testCase = evaluationCases[0]!;
    const sdk = script([[call("portfolio_summary")], [text("Estimated 90,000 points worth $1,170.")]]);
    const result = await runEvaluationCase(testCase, { modelName: "injected", model: sdk.model });
    expect(result).toMatchObject({ status: "passed", modelRequests: 2, inputTokens: 22, outputTokens: 14, totalTokens: 36, usageAvailable: true });
    expect(JSON.stringify(result)).not.toContain(testCase.message);
    expect(JSON.stringify(result)).not.toContain("$1,170");
    const failure = script([]);
    failure.model.getResponse = async () => { throw new Error("SYNTHETIC_CREDENTIAL_CANARY"); };
    const failed = await runEvaluationCase(testCase, { modelName: "injected", model: failure.model });
    expect(failed.status).toBe("unavailable");
    expect(failed.failureKind).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("CANARY");
  });

  it("fails plausible hallucinations and unreviewed execution claims instead of treating fluency as success", () => {
    const testCase = evaluationCases[0]!;
    const fixture = createEvaluationFixture(testCase);
    const checks = scoreEvaluation(testCase, "You have 500,000 points. I have already booked your flights.", fixture, []);
    expect(checks.filter(check => !check.passed).map(check => check.name)).toEqual(expect.arrayContaining(["required_tools", "required_language", "no_execution_claim"]));
  });

  it("bounds CLI trace teardown and distinguishes flush completion from delivery", async () => {
    expect(await flushEvaluationTraces(20, async () => {})).toBe("completed");
    expect(await flushEvaluationTraces(20, async () => { throw new Error("private provider error"); })).toBe("failed");
    expect(await flushEvaluationTraces(20, () => new Promise(() => {}))).toBe("timeout");
  });

  it("selects cases before inference, rejects unknown IDs and reports trace intent without asserting delivery", async () => {
    const sdk = script([[call("portfolio_summary")], [text("Estimated 90,000 points worth $1,170.")]]);
    await expect(runEvaluationSuite({ modelName: "injected", model: sdk.model, caseIds: ["unknown-case"] })).rejects.toThrow("Unknown evaluation case");
    expect(sdk.requests).toHaveLength(0);
    const report = await runEvaluationSuite({ modelName: "injected", model: sdk.model, caseIds: ["portfolio-grounding"] });
    expect(report).toMatchObject({ mode: "injected", passed: true, semanticReviewRequired: true, tracingRequested: false, tracingEffective: false, traceFlush: "not_requested", traceDeliveryVerified: false });
    expect(report.results).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain(evaluationCases[0]!.message);
    expect(sdk.requests).toHaveLength(2);
  });
});
