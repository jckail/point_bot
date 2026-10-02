import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { enableLiveEvaluationTracing, runEvaluationSuite } from "../evaluation/run";

// Ordinary tests never read inference credentials and never invoke a paid model.
describe.skipIf(process.env.POINTUP_EVAL_LIVE !== "1")("opt-in live assistant evaluation", () => {
  it("evaluates only invented portfolios and writes a sanitized summary", async () => {
    const modelName = process.env.POINTUP_EVAL_MODEL;
    const apiKey = process.env.OPENAI_API_KEY;
    const output = process.env.POINTUP_EVAL_OUTPUT;
    if (!modelName || !apiKey || !output) throw new Error("Live evaluation requires explicit model, API key and output path.");
    const tracingRequested = process.env.POINTUP_EVAL_TRACE === "1";
    enableLiveEvaluationTracing(tracingRequested);
    const report = await runEvaluationSuite({ modelName, apiKey, tracing: tracingRequested, caseIds: process.env.POINTUP_EVAL_CASES ? JSON.parse(process.env.POINTUP_EVAL_CASES) as string[] : undefined });
    // Exclusive creation protects an existing artifact; no prompts or replies are written.
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    expect(report.passed, "See sanitized per-case checks and review the dataset rubric").toBe(true);
  }, 360000);
});
