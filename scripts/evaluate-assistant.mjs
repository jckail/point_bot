#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const help = `PointUp synthetic assistant evaluations
No inference occurs without --live. Supply OPENAI_API_KEY through your existing environment.
Usage: node scripts/evaluate-assistant.mjs --live --model MODEL --output NEW_FILE [--case CASE_ID] [--trace]
The live run makes up to five model turns per case (twelve cases by default), sequentially.
No database or real portfolios are used. Reports contain checks and usage, not prompts or replies.
Review docs/assistant-evaluations.md for the case rubric and limitations.`;
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.info(help);
  process.exit(0);
}
let live = false;
let tracing = false;
let model;
let output;
const caseIds = [];
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === "--live") live = true;
  else if (flag === "--trace") tracing = true;
  else if (["--model", "--output", "--case"].includes(flag)) {
    const value = args[++i];
    if (!value || value.startsWith("--")) { console.error("Missing evaluation option value."); process.exit(2); }
    if (flag === "--model") model = value;
    else if (flag === "--output") output = value;
    else caseIds.push(value);
  } else { console.error("Unknown evaluation option. Use --help."); process.exit(2); }
}
if (!live || !model?.trim() || !output || !process.env.OPENAI_API_KEY?.trim()) {
  console.error("Live evaluation requires --live, --model, --output and OPENAI_API_KEY.");
  process.exit(2);
}
const outputPath = path.resolve(output);
if (existsSync(outputPath)) { console.error("Evaluation output already exists; choose a new file."); process.exit(2); }
const root = fileURLToPath(new URL("../", import.meta.url));
const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
if (!existsSync(vitest)) { console.error("Install repository dependencies before running evaluations."); process.exit(2); }
const child = spawnSync(process.execPath, [vitest, "run", "src/server/assistant-agent/__tests__/live-evaluation.test.ts", "--maxWorkers=1", "--minWorkers=1"], {
  cwd: path.join(root, "apps/web"),
  env: { ...process.env, POINTUP_EVAL_LIVE: "1", POINTUP_EVAL_MODEL: model, POINTUP_EVAL_OUTPUT: outputPath, POINTUP_EVAL_TRACE: tracing ? "1" : "0", POINTUP_EVAL_CASES: caseIds.length ? JSON.stringify(caseIds) : "" },
  stdio: "inherit",
  timeout: 370000,
});
if (child.error) { console.error("Evaluation runner could not complete."); process.exit(2); }
process.exit(child.status ?? 2);
