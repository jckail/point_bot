/**
 * Generates the ChatGPT Custom GPT Action spec from the same zod contracts the
 * API serves, so it cannot drift. Usage:
 *
 *   POINTUP_URL=https://app.example.com npx tsx plugins/chatgpt/build.ts
 *
 * Output: plugins/chatgpt/dist/openapi.json (paste/import into the GPT builder
 * → Actions → Import from URL/Schema). ChatGPT limits Actions to 30 operations
 * and 300-char descriptions, so only a curated allow-list is exported, and
 * session-only operations (token minting, consent granting) are excluded on
 * purpose: those stay in the dashboard where the human is present.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenApiDocument } from "../../packages/core/src/contracts/openapi";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- OpenAPI documents are free-form JSON

const ALLOW: Record<string, string> = {
  "GET /api/v1/summary": "getPortfolioSummary",
  "GET /api/v1/loyalty-accounts": "listAccounts",
  "POST /api/v1/loyalty-accounts": "linkAccount",
  "GET /api/v1/loyalty-accounts/{id}": "getAccount",
  "GET /api/v1/loyalty-accounts/{id}/balances": "getBalanceHistory",
  "POST /api/v1/loyalty-accounts/{id}/balances": "recordBalance",
  "GET /api/v1/expiring": "listExpiring",
  "GET /api/v1/goals": "listGoals",
  "POST /api/v1/goals": "createGoal",
  "GET /api/v1/value-advice": "getValueAdvice",
  "GET /api/v1/providers": "listProviders",
  "GET /api/v1/activity": "listActivity",
  "GET /api/v1/skills": "listAgentSkills",
  "GET /api/v1/consents": "listConsents",
  "GET /api/v1/agent/observations": "listObservations",
  "POST /api/v1/agent/observations": "submitObservation",
};

const MAX_OPERATIONS = 30;
const MAX_DESCRIPTION = 300;

export function buildChatGptSpec(serverUrl: string): Json {
  const full = buildOpenApiDocument({ serverUrl }) as Json;
  const paths: Json = {};
  let count = 0;

  for (const [path, item] of Object.entries<Json>(full.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const key = `${method.toUpperCase()} ${path}`;
      const operationId = ALLOW[key];
      if (!operationId || !item[method]) continue;
      const operation = { ...item[method], operationId };
      const summary: string = operation.summary ?? operationId;
      operation.summary = summary.slice(0, MAX_DESCRIPTION);
      operation["x-openai-isConsequential"] = method !== "get";
      paths[path] = paths[path] ?? {};
      if (item.parameters) paths[path].parameters = item.parameters;
      paths[path][method] = operation;
      count += 1;
    }
  }

  const missing = Object.keys(ALLOW).filter((key) => {
    const [method = "", path = ""] = key.split(" ");
    return !paths[path]?.[method.toLowerCase()];
  });
  if (missing.length) {
    throw new Error(`Allow-listed operations missing from the API: ${missing.join(", ")}`);
  }
  if (count > MAX_OPERATIONS) {
    throw new Error(`ChatGPT Actions allow ${MAX_OPERATIONS} operations; got ${count}`);
  }

  return {
    ...full,
    info: {
      ...full.info,
      title: "PointUp",
      description:
        "Manage loyalty points: portfolio, expiry, goals, advice, and consented balance write-back.",
    },
    servers: [{ url: serverUrl }],
    security: [{ accessToken: [] }],
    components: {
      ...full.components,
      securitySchemes: { accessToken: full.components.securitySchemes.accessToken },
    },
    paths,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const serverUrl = process.env.POINTUP_URL ?? "https://app.pointup.example";
  const out = join(dirname(fileURLToPath(import.meta.url)), "dist", "openapi.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildChatGptSpec(serverUrl), null, 2));
  console.log(`wrote ${out}`);
}
