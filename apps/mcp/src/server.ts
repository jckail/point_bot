import type { PointUpClient } from "@pointup/api-client";
import { PointUpApiError } from "@pointup/api-client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * MCP surface over the PointUp API. This is a thin adapter: every tool is one
 * API call made with the *caller's own* personal access token, so scopes,
 * consent, and ownership checks are enforced by the same use cases as every
 * other surface. The server holds no state and no credentials.
 */

export interface ServerOptions {
  /** Per-session API client (token baked in). */
  readonly client: PointUpClient;
  /** Dashboard URL for deep links, e.g. https://app.pointup.example */
  readonly appUrl: string;
  readonly agentName: string;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function fail(error: unknown): ToolResult {
  const message =
    error instanceof PointUpApiError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wraps a handler so API errors become MCP tool errors, not protocol errors. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function createPointUpMcpServer(options: ServerOptions): McpServer {
  const { client, appUrl, agentName } = options;
  const server = new McpServer(
    { name: "pointup", version: "1.0.0" },
    {
      instructions: [
        "PointUp tracks the user's loyalty points (airline, hotel, card, rail, shopping).",
        "Reading is always allowed with a portfolio:read token.",
        "To read a balance from a provider website with a browser/computer agent, follow the flow: pointup_list_skills → confirm consent is active (never self-approve; use pointup_request_consent which asks the user) → read the page in the user's own signed-in browser → pointup_submit_balance.",
        "Never ask for, type, or store the user's loyalty passwords.",
      ].join(" "),
    },
  );

  // ─── Read tools ──────────────────────────────────────────────────────────

  server.registerTool(
    "pointup_get_portfolio_summary",
    {
      title: "Portfolio summary",
      description:
        "Total points, estimated value, per-kind breakdown, and last sync for the user's whole loyalty portfolio.",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => client.getPortfolioSummary()),
  );

  server.registerTool(
    "pointup_list_accounts",
    {
      title: "List loyalty accounts",
      description:
        "All linked programs with latest balance, estimated value, trend, expiry, notes, tags.",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => client.listLoyaltyAccounts()),
  );

  server.registerTool(
    "pointup_get_account",
    {
      title: "Get one account",
      inputSchema: { accountId: z.string().min(1) },
      annotations: READ,
    },
    ({ accountId }) => run(() => client.getLoyaltyAccount(accountId)),
  );

  server.registerTool(
    "pointup_list_providers",
    {
      title: "List supported programs",
      description: "The catalog of supported programs and their provider ids.",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => client.listProviders()),
  );

  server.registerTool(
    "pointup_get_balance_history",
    {
      title: "Balance history",
      inputSchema: {
        accountId: z.string().min(1),
        limit: z.number().int().min(1).max(365).optional(),
      },
      annotations: READ,
    },
    ({ accountId, limit }) =>
      run(() => client.getBalanceHistory(accountId, limit)),
  );

  server.registerTool(
    "pointup_list_expiring",
    {
      title: "Points at risk of expiring",
      inputSchema: { withinDays: z.number().int().min(1).max(730).optional() },
      annotations: READ,
    },
    ({ withinDays }) => run(() => client.listExpiringAccounts(withinDays)),
  );

  server.registerTool(
    "pointup_get_value_advice",
    {
      title: "Bang-for-buck advice",
      description:
        "Ranked transfer/redemption ideas using the transfer-partner graph and curated deals.",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => client.getValueAdvice()),
  );

  server.registerTool(
    "pointup_list_goals",
    {
      title: "Trip goals and progress",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => client.listTripGoals()),
  );

  server.registerTool(
    "pointup_list_activity",
    {
      title: "Recent activity",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: READ,
    },
    ({ limit }) => run(() => client.listActivity(limit)),
  );

  // ─── Write tools (portfolio:write) ───────────────────────────────────────

  server.registerTool(
    "pointup_link_account",
    {
      title: "Link a loyalty program",
      description:
        "Link a program by provider id and membership number. No password is stored.",
      inputSchema: {
        providerId: z.string().min(1),
        membershipNumber: z.string().min(1),
      },
      annotations: WRITE,
    },
    (input) => run(() => client.linkLoyaltyAccount(input)),
  );

  server.registerTool(
    "pointup_record_balance",
    {
      title: "Record a balance the user told you",
      description:
        "Record a balance the USER stated (source=manual). For balances you read from a website, use pointup_submit_balance instead so consent and audit apply.",
      inputSchema: {
        accountId: z.string().min(1),
        points: z.number().int().nonnegative(),
        capturedAt: z.iso.datetime().optional(),
      },
      annotations: WRITE,
    },
    ({ accountId, ...body }) => run(() => client.recordManualBalance(accountId, body)),
  );

  server.registerTool(
    "pointup_create_goal",
    {
      title: "Create a trip goal",
      inputSchema: {
        title: z.string().min(1).max(120),
        targetPoints: z.number().int().positive(),
        targetDate: z.string().optional(),
        accountIds: z.array(z.string()).optional(),
      },
      annotations: WRITE,
    },
    (input) => run(() => client.createTripGoal(input)),
  );

  // ─── Agent skills & write-back ───────────────────────────────────────────

  server.registerTool(
    "pointup_list_skills",
    {
      title: "List browser/computer skills",
      description:
        "Playbooks for reading a balance from a provider site in the user's own browser, with whether the program is linked and consent is active.",
      inputSchema: { providerId: z.string().optional() },
      annotations: READ,
    },
    ({ providerId }) => run(() => client.listAgentSkills(providerId)),
  );

  server.registerTool(
    "pointup_request_consent",
    {
      title: "Ask the user for consent to read a program",
      description:
        "Asks the USER (via an interactive prompt in their client) to allow agents to read one program's balance and write it back for N days. Does nothing without an explicit yes. If the client cannot prompt, returns a dashboard link for the user to grant it themselves.",
      inputSchema: {
        providerId: z.string().min(1),
        days: z.number().int().min(1).max(90).optional(),
      },
      annotations: WRITE,
    },
    async ({ providerId, days }) => {
      const link = `${appUrl}/dashboard/agents`;
      const supportsElicitation =
        !!server.server.getClientCapabilities()?.elicitation;
      if (!supportsElicitation) {
        return ok({
          granted: false,
          reason: "client cannot prompt the user",
          action: `Ask the user to grant consent for "${providerId}" at ${link}`,
        });
      }
      try {
        const answer = await server.server.elicitInput({
          mode: "form",
          message: `Allow ${agentName} to read your "${providerId}" balance from your own browser and save it to PointUp for ${days ?? 30} days? You can revoke this any time at ${link}.`,
          requestedSchema: {
            type: "object",
            properties: {
              approve: { type: "boolean", title: "Allow", default: false },
            },
            required: ["approve"],
          },
        });
        if (answer.action !== "accept" || answer.content?.approve !== true) {
          return ok({ granted: false, reason: "user declined" });
        }
        return ok({
          granted: true,
          consent: await client.grantConsent({ providerId, days }),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "pointup_submit_balance",
    {
      title: "Write back a balance read from a provider site",
      description:
        "Submit the points balance you read from the user's own signed-in provider page. Requires an active consent for the program (see pointup_request_consent) and a sourceUrl on the skill's allowed hosts. Outcome 'needs_review' means the value looks implausible: show it to the user and resubmit with confirmed=true only if they agree.",
      inputSchema: {
        skillId: z.string().min(1).describe("e.g. united.capture-balance"),
        points: z.number().int().nonnegative(),
        sourceUrl: z.url().describe("Exact https page the value was read from"),
        observedAt: z.iso.datetime().optional(),
        membershipNumber: z
          .string()
          .optional()
          .describe("Only to auto-link a program that is not linked yet"),
        confirmed: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    (input) =>
      run(() => client.submitObservation({ ...input, agent: agentName })),
  );

  server.registerTool(
    "pointup_list_observations",
    {
      title: "Audit trail of agent write-backs",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => client.listObservations()),
  );

  // ─── Prompts: reusable playbooks ─────────────────────────────────────────

  server.registerPrompt(
    "capture-balance",
    {
      title: "Capture a balance from a provider site",
      description:
        "Step-by-step playbook for a browser/computer agent to read one program's balance with the user's consent and write it back.",
      argsSchema: { providerId: z.string() },
    },
    async ({ providerId }) => {
      const skills = await client.listAgentSkills(providerId);
      const skill = skills.find((s) => s.mode === "browser") ?? skills[0];
      const text = skill
        ? [
            `Goal: ${skill.title}.`,
            `Skill id: ${skill.id}. Start URL: ${skill.startUrl}. Allowed hosts: ${skill.allowedHosts.join(", ")}.`,
            `Linked: ${skill.accountLinked}. Consent active: ${skill.consentActive}.`,
            skill.consentActive
              ? ""
              : "Consent is NOT active: call pointup_request_consent first.",
            `What to read: ${skill.extraction.hint}.`,
            "Steps:",
            ...skill.steps.map((step, i) => `${i + 1}. ${step}`),
            "Finish with pointup_submit_balance.",
          ]
            .filter(Boolean)
            .join("\n")
        : `No skill exists for "${providerId}". Use pointup_list_providers to check the id.`;
      return {
        messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
      };
    },
  );

  server.registerPrompt(
    "portfolio-review",
    {
      title: "Review my points portfolio",
      description: "Summarize balances, expiring points, goals, and best redemptions.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Review my loyalty portfolio. Call pointup_get_portfolio_summary, pointup_list_expiring, pointup_list_goals and pointup_get_value_advice, then give me: total value, anything expiring soon, progress on goals, and the top 3 actions.",
          },
        },
      ],
    }),
  );

  return server;
}
