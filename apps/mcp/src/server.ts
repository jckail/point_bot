import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PointUpApiError, type PointUpClient } from "@pointup/api-client";
import { z } from "zod";

const id = z.string().min(1).max(128);
const empty = z.object({}).strict();
const schemas = {
  portfolio_summary: empty,
  list_accounts: empty,
  list_providers: empty,
  list_goals: empty,
  value_advice: empty,
  balance_history: z.object({ accountId: id, limit: z.number().int().min(1).max(365).optional() }).strict(),
  expiring_accounts: z.object({ withinDays: z.number().int().min(1).max(365).optional() }).strict(),
  list_activity: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
  record_balance: z.object({ accountId: id, points: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), capturedAt: z.iso.datetime().optional() }).strict(),
  create_goal: z.object({ title: z.string().min(1).max(120), targetPoints: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), targetDate: z.iso.date().nullish(), accountIds: z.array(id).max(100).optional(), notes: z.string().max(2000).nullish() }).strict(),
};
type ToolName = keyof typeof schemas;
const writes = new Set<ToolName>(["record_balance", "create_goal"]);
const descriptions: Record<ToolName, string> = {
  portfolio_summary: "Read the signed-in user's loyalty portfolio totals and value.",
  list_accounts: "Read the signed-in user's linked loyalty accounts and balances. Membership numbers may be sensitive.",
  list_providers: "Read supported loyalty programs.",
  list_goals: "Read the signed-in user's trip goals.",
  value_advice: "Read estimated points value advice; estimates are not award availability or booking quotes.",
  balance_history: "Read an account's balance history, at most 365 records.",
  expiring_accounts: "Read accounts expiring within the requested number of days.",
  list_activity: "Read recent portfolio activity, at most 100 records.",
  record_balance: "Prepare a persisted manual balance proposal for review. Does not execute a change. User must approve the exact stored values in PointUp browser settings.",
  create_goal: "Prepare a persisted trip goal proposal for review. Does not execute a change. User must approve the exact stored values in PointUp browser settings.",
};

function result(data: unknown, isError = false): CallToolResult {
  const serialized = JSON.stringify(data);
  if (serialized.length > 128_000) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "RESULT_TOO_LARGE", message: "Result exceeds the local MCP output limit. Use a narrower query in PointUp." } }) }] };
  }
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: serialized }] };
}

export function createToolService(client: PointUpClient, allowWrites = false) {
  const names = Object.keys(schemas) as ToolName[];
  return {
    list() {
      return names.filter(name => allowWrites || !writes.has(name)).map(name => ({
        name,
        description: descriptions[name],
        inputSchema: z.toJSONSchema(schemas[name]) as { type: "object"; [key: string]: unknown },
        annotations: { readOnlyHint: !writes.has(name), destructiveHint: false, idempotentHint: !writes.has(name), openWorldHint: true },
      }));
    },
    async call(name: string, args: unknown): Promise<CallToolResult> {
      if (!Object.hasOwn(schemas, name) || (!allowWrites && writes.has(name as ToolName))) {
        return result({ error: { code: "UNKNOWN_TOOL", message: "Tool is unavailable in this server configuration." } }, true);
      }
      const parsed = schemas[name as ToolName].safeParse(args ?? {});
      if (!parsed.success) {
        // Report paths only; input values and API messages could contain credentials.
        return result({ error: { code: "INVALID_ARGUMENTS", message: "Tool arguments failed validation.", fields: parsed.error.issues.map(issue => issue.path.join(".")) } }, true);
      }
      try {
        // Parse each schema here for exact per-tool typing, after common validation.
        switch (name as ToolName) {
          case "portfolio_summary": return result(await client.getPortfolioSummary());
          case "list_accounts": return result(await client.listLoyaltyAccounts());
          case "list_providers": return result(await client.listProviders());
          case "list_goals": return result(await client.listTripGoals());
          case "value_advice": return result(await client.getValueAdvice());
          case "balance_history": { const a = schemas.balance_history.parse(args); return result(await client.getBalanceHistory(a.accountId, a.limit)); }
          case "expiring_accounts": { const a = schemas.expiring_accounts.parse(args ?? {}); return result(await client.listExpiringAccounts(a.withinDays)); }
          case "list_activity": { const a = schemas.list_activity.parse(args ?? {}); return result(await client.listActivity(a.limit)); }
          case "record_balance": { const a = schemas.record_balance.parse(args); return result({ ...await client.proposeAssistantAction({ kind: "manual_balance", accountId: a.accountId, points: a.points, capturedAt: a.capturedAt }), requiresBrowserApproval: true, reviewPath: "/dashboard/settings" }); }
          case "create_goal": { const a = schemas.create_goal.parse(args); return result({ ...await client.proposeAssistantAction({ kind: "trip_goal", title: a.title, targetPoints: a.targetPoints, targetDate: a.targetDate, accountIds: a.accountIds, notes: a.notes }), requiresBrowserApproval: true, reviewPath: "/dashboard/settings" }); }
        }
      } catch (error) {
        if (error instanceof PointUpApiError) {
          const message = error.status === 401 ? "PointUp credential expired, revoked, or invalid. Supply a fresh approved token." : "PointUp rejected the request. Review it in the app.";
          return result({ error: { code: "API_ERROR", status: error.status, message } }, true);
        }
        return result({ error: { code: "REQUEST_FAILED", message: "PointUp request failed or timed out. Check the API origin and connectivity." } }, true);
      }
    },
  };
}

export function createServer(client: PointUpClient, allowWrites = false) {
  const service = createToolService(client, allowWrites);
  const server = new Server({ name: "pointup", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: service.list() }));
  server.setRequestHandler(CallToolRequestSchema, async request => service.call(request.params.name, request.params.arguments));
  return server;
}
