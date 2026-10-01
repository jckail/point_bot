import type { PointUpClient } from "@pointup/api-client";
import { PointUpApiError } from "@pointup/api-client";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  activityEventDtoSchema,
  agentObservationDtoSchema,
  agentSkillDtoSchema,
  loyaltyAccountDtoSchema,
  portfolioSummaryDtoSchema,
  providerDtoSchema,
  tripGoalDtoSchema,
  valueAdviceDtoSchema,
  type AgentSkillDto,
} from "@pointup/core/contracts";
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
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Ids are opaque strings; reject blanks and absurd lengths before any API call. */
const idSchema = z.string().trim().min(1).max(200);
/** Points fit a 32-bit integer column; larger values are always a misread. */
const pointsSchema = z.number().int().nonnegative().max(2_147_483_647);

/** MCP structured output must be an object, so arrays are wrapped as { items }. */
function listOutput<T extends z.ZodType>(item: T) {
  return { items: z.array(item) };
}

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

/**
 * Like run(), but also returns structuredContent (matching the tool's
 * outputSchema). The JSON text stays for clients that ignore structured output.
 */
async function runStructured(
  fn: () => Promise<unknown>,
  wrap = false,
): Promise<ToolResult> {
  try {
    const value = await fn();
    const structured = (wrap ? { items: value } : value) as Record<string, unknown>;
    return { ...ok(value), structuredContent: structured };
  } catch (error) {
    return fail(error);
  }
}

/** Plain-text playbook shared by the capture-balance prompt and skill resources. */
export function renderSkillPlaybook(skill: AgentSkillDto): string {
  const caveats = [
    ...(skill.unverified
      ? [
          "UNVERIFIED: the start URL and hint are best-effort and were not checked against the live site. Tell the user, and if the page does not match, stop rather than guess.",
        ]
      : []),
    ...(skill.notes ?? []),
  ];
  return [
    `Goal: ${skill.title}.`,
    `Skill id: ${skill.id} (v${skill.version}). Start URL: ${skill.startUrl}. Allowed hosts: ${skill.allowedHosts.join(", ")}.`,
    `Linked: ${skill.accountLinked}. Consent active: ${skill.consentActive}.`,
    skill.consentActive
      ? ""
      : "Consent is NOT active: call pointup_request_consent first.",
    `What to read: ${skill.extraction.hint}.`,
    ...(caveats.length ? ["Caveats:", ...caveats.map((c) => `- ${c}`)] : []),
    "Steps:",
    ...skill.steps.map((step, i) => `${i + 1}. ${step}`),
    "Finish with pointup_submit_balance.",
  ]
    .filter(Boolean)
    .join("\n");
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
        "Start here for 'how many points do I have?'. Total points, estimated value, per-kind breakdown (airline, hotel, card, rail, shopping) and last sync for the user's whole loyalty portfolio. Read-only.",
      inputSchema: {},
      outputSchema: portfolioSummaryDtoSchema.shape,
      annotations: READ,
    },
    () => runStructured(() => client.getPortfolioSummary()),
  );

  server.registerTool(
    "pointup_list_accounts",
    {
      title: "List loyalty accounts",
      description:
        "All linked programs with latest balance, estimated value, trend, expiry, notes and tags. Use the returned account ids for pointup_get_account, pointup_get_balance_history and pointup_record_balance. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(loyaltyAccountDtoSchema),
      annotations: READ,
    },
    () => runStructured(() => client.listLoyaltyAccounts(), true),
  );

  server.registerTool(
    "pointup_get_account",
    {
      title: "Get one account",
      description:
        "One linked program by account id (from pointup_list_accounts): balance, value, trend, expiry. Read-only.",
      inputSchema: { accountId: idSchema },
      outputSchema: loyaltyAccountDtoSchema.shape,
      annotations: READ,
    },
    ({ accountId }) => runStructured(() => client.getLoyaltyAccount(accountId)),
  );

  server.registerTool(
    "pointup_list_providers",
    {
      title: "List supported programs",
      description:
        "The catalog of supported programs and their provider ids (e.g. 'united'). Use these ids for pointup_link_account, pointup_list_skills and pointup_request_consent. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(providerDtoSchema),
      annotations: READ,
    },
    () => runStructured(() => client.listProviders(), true),
  );

  server.registerTool(
    "pointup_get_balance_history",
    {
      title: "Balance history",
      description:
        "Recorded balance snapshots for one account, newest first (default 30, max 365), with their source (sync, manual or agent). Read-only.",
      inputSchema: {
        accountId: idSchema,
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
      description:
        "Accounts whose points expire within N days (default per server, max 730). Use before suggesting redemptions or activity to keep points alive. Read-only.",
      inputSchema: { withinDays: z.number().int().min(1).max(730).optional() },
      outputSchema: listOutput(loyaltyAccountDtoSchema),
      annotations: READ,
    },
    ({ withinDays }) =>
      runStructured(() => client.listExpiringAccounts(withinDays), true),
  );

  server.registerTool(
    "pointup_get_value_advice",
    {
      title: "Bang-for-buck advice",
      description:
        "Ranked transfer/redemption ideas using the transfer-partner graph and curated deals. Estimates, not guarantees: tell the user to verify availability. Read-only.",
      inputSchema: {},
      outputSchema: valueAdviceDtoSchema.shape,
      annotations: READ,
    },
    () => runStructured(() => client.getValueAdvice()),
  );

  server.registerTool(
    "pointup_list_goals",
    {
      title: "Trip goals and progress",
      description:
        "The user's trip goals with target points, linked accounts and progress. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(tripGoalDtoSchema),
      annotations: READ,
    },
    () => runStructured(() => client.listTripGoals(), true),
  );

  server.registerTool(
    "pointup_list_activity",
    {
      title: "Recent activity",
      description:
        "Recent portfolio events (balance changes, links, agent write-backs), newest first (default 50, max 200). For the audit trail of agent write-backs only, use pointup_list_observations. Read-only.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      outputSchema: listOutput(activityEventDtoSchema),
      annotations: READ,
    },
    ({ limit }) => runStructured(() => client.listActivity(limit), true),
  );

  // ─── Write tools (portfolio:write) ───────────────────────────────────────

  server.registerTool(
    "pointup_link_account",
    {
      title: "Link a loyalty program",
      description:
        "Link a program by provider id and membership number. No password is stored.",
      inputSchema: {
        providerId: idSchema,
        membershipNumber: z.string().trim().min(1).max(64),
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
        accountId: idSchema,
        points: pointsSchema,
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
        title: z.string().trim().min(1).max(120),
        targetPoints: z.number().int().positive().max(2_147_483_647),
        targetDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
          .optional(),
        accountIds: z.array(idSchema).max(50).optional(),
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
        "Playbooks for reading a balance from a provider site in the user's own browser, with whether the program is linked and consent is active. Each skill has an 'unverified' flag: when true, its start URL is best-effort, so tell the user and stop if the page does not match. Also available as resources pointup://skills/{skillId}.",
      inputSchema: { providerId: idSchema.optional() },
      outputSchema: listOutput(agentSkillDtoSchema),
      annotations: READ,
    },
    ({ providerId }) =>
      runStructured(() => client.listAgentSkills(providerId), true),
  );

  server.registerTool(
    "pointup_request_consent",
    {
      title: "Ask the user for consent to read a program",
      description:
        "Asks the USER (via an interactive prompt in their client) to allow agents to read one program's balance and write it back for N days. Does nothing without an explicit yes. If the client cannot prompt, returns a dashboard link for the user to grant it themselves.",
      inputSchema: {
        providerId: idSchema,
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
        skillId: idSchema.describe("e.g. united.capture-balance"),
        points: pointsSchema,
        sourceUrl: z
          .url({ protocol: /^https$/, error: "sourceUrl must be an https URL" })
          .max(2048)
          .describe("Exact https page the value was read from"),
        observedAt: z.iso.datetime().optional(),
        membershipNumber: z
          .string()
          .trim()
          .min(1)
          .max(64)
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
      description:
        "Audit trail of balances agents wrote back (provider, skill, agent, source host, outcome). The source host is stored, never the full URL. Use it to confirm a pointup_submit_balance landed. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(agentObservationDtoSchema),
      annotations: READ,
    },
    () => runStructured(() => client.listObservations(), true),
  );

  // ─── Resources: read-only context an MCP client can attach ───────────────

  server.registerResource(
    "portfolio-summary",
    "pointup://portfolio/summary",
    {
      title: "Portfolio summary",
      description: "Current totals and per-kind breakdown (JSON).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await client.getPortfolioSummary(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "skill-playbook",
    new ResourceTemplate("pointup://skills/{skillId}", {
      list: async () => {
        const skills = await client.listAgentSkills();
        return {
          resources: skills.map((skill) => ({
            uri: `pointup://skills/${encodeURIComponent(skill.id)}`,
            name: skill.id,
            title: skill.title,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Balance-capture playbook",
      description:
        "Step-by-step playbook for reading one program's balance (mode browser or computer), including the verification status of its start URL.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const skillId = decodeURIComponent(String(variables.skillId));
      const skill = (await client.listAgentSkills()).find((s) => s.id === skillId);
      if (!skill) throw new Error(`Unknown skill "${skillId}"`);
      return {
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: renderSkillPlaybook(skill) },
        ],
      };
    },
  );

  // ─── Prompts: reusable playbooks ─────────────────────────────────────────

  server.registerPrompt(
    "capture-balance",
    {
      title: "Capture a balance from a provider site",
      description:
        "Step-by-step playbook for a browser/computer agent to read one program's balance with the user's consent and write it back.",
      argsSchema: { providerId: idSchema },
    },
    async ({ providerId }) => {
      const skills = await client.listAgentSkills(providerId);
      const skill = skills.find((s) => s.mode === "browser") ?? skills[0];
      const text = skill
        ? renderSkillPlaybook(skill)
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
