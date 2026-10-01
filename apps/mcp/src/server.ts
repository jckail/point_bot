import type { PointUpClient } from "@pointup/api-client";
import { PointUpApiError } from "@pointup/api-client";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  activityEventDtoSchema,
  agentObservationDtoSchema,
  agentSkillDtoSchema,
  loyaltyAccountDtoSchema,
  planRedemptionResultDtoSchema,
  portfolioSummaryDtoSchema,
  providerDtoSchema,
  sweetSpotDtoSchema,
  transferBonusDtoSchema,
  tripGoalDtoSchema,
  valueAdviceDtoSchema,
  type AgentSkillDto,
} from "@pointup/core/contracts";
import {
  METRIC_NAMES,
  getObservability,
  type Logger,
  type Observability,
} from "@pointup/core/observability";
import { PROVIDER_CATALOG } from "@pointup/core/providers";
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
  /** Correlation id of the inbound HTTP request (logged with every tool call). */
  readonly requestId?: string;
  /** Telemetry sinks; defaults to the process-wide configuration. */
  readonly observability?: Observability;
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
    const structured = (wrap ? { items: value } : value) as Record<
      string,
      unknown
    >;
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
      : "Consent is NOT active: call pointup_request_consent for the dashboard link and ask the user to grant it there. Stop until they have.",
    `What to read: ${skill.extraction.hint}.`,
    ...(caveats.length ? ["Caveats:", ...caveats.map((c) => `- ${c}`)] : []),
    "Steps:",
    ...skill.steps.map((step, i) => `${i + 1}. ${step}`),
    "Finish with pointup_submit_balance.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Wraps a tool callback with a span, a log line and `mcp_tool_calls_total`.
 * Tool arguments and results are never logged (they can hold user data).
 * A result with `isError` (the `run()` convention) counts as an error outcome.
 */
export function instrumentTool<A extends unknown[]>(
  tool: string,
  callback: (...args: A) => unknown,
  requestId?: string,
  observability?: Observability,
): (...args: A) => Promise<unknown> {
  return async (...args: A) => {
    const { tracer, metrics, logger } = observability ?? getObservability();
    const log: Logger = requestId ? logger.child({ requestId }) : logger;
    const started = performance.now();
    let outcome: "ok" | "error" = "ok";
    try {
      return await tracer.withSpan(
        `mcp.tool ${tool}`,
        { "mcp.tool": tool, ...(requestId ? { "request.id": requestId } : {}) },
        async (span) => {
          try {
            const result = await callback(...args);
            if ((result as { isError?: boolean } | undefined)?.isError) {
              outcome = "error";
            }
            span.setAttribute("mcp.outcome", outcome);
            return result;
          } catch (error) {
            outcome = "error";
            span.setAttribute("mcp.outcome", "error");
            throw error;
          }
        },
      );
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      metrics.counter(METRIC_NAMES.mcp_tool_calls_total, { tool, outcome });
      log[outcome === "ok" ? "info" : "warn"]("mcp_tool_call", {
        tool,
        outcome,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    }
  };
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/** Per-request state bound into the shared tool handlers (never stored globally). */
interface ToolContext {
  readonly client: PointUpClient;
  readonly appUrl: string;
  readonly agentName: string;
}

type ToolDef = readonly [
  name: string,
  config: Record<string, unknown>,
  bind: (ctx: ToolContext) => (...args: any[]) => unknown, // eslint-disable-line @typescript-eslint/no-explicit-any
];

/** Tool table: schemas and descriptions are built once at module load and shared (immutable). */
const RAW_TOOL_DEFS: readonly ToolDef[] = [
  [
    "pointup_get_portfolio_summary",
    {
      title: "Portfolio summary",
      description:
        "Start here for 'how many points do I have?'. Total points, estimated value, per-kind breakdown (airline, hotel, card, rail, shopping) and last sync for the user's whole loyalty portfolio. Read-only.",
      inputSchema: {},
      outputSchema: portfolioSummaryDtoSchema.shape,
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.getPortfolioSummary()),
  ],
  [
    "pointup_list_accounts",
    {
      title: "List loyalty accounts",
      description:
        "All linked programs with latest balance, estimated value, trend, expiry, notes and tags. Use the returned account ids for pointup_get_account, pointup_get_balance_history and pointup_record_balance. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(loyaltyAccountDtoSchema),
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.listLoyaltyAccounts(), true),
  ],
  [
    "pointup_get_account",
    {
      title: "Get one account",
      description:
        "One linked program by account id (from pointup_list_accounts): balance, value, trend, expiry. Read-only.",
      inputSchema: { accountId: idSchema },
      outputSchema: loyaltyAccountDtoSchema.shape,
      annotations: READ,
    },
    (ctx) =>
      ({ accountId }) =>
        runStructured(() => ctx.client.getLoyaltyAccount(accountId)),
  ],
  [
    "pointup_list_providers",
    {
      title: "List supported programs",
      description:
        "The catalog of supported programs and their provider ids (e.g. 'united'). Use these ids for pointup_link_account, pointup_list_skills and pointup_request_consent. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(providerDtoSchema),
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.listProviders(), true),
  ],
  [
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
    (ctx) =>
      ({ accountId, limit }) =>
        run(() => ctx.client.getBalanceHistory(accountId, limit)),
  ],
  [
    "pointup_list_expiring",
    {
      title: "Points at risk of expiring",
      description:
        "Accounts whose points expire within N days (default per server, max 730). Use before suggesting redemptions or activity to keep points alive. Read-only.",
      inputSchema: { withinDays: z.number().int().min(1).max(730).optional() },
      outputSchema: listOutput(loyaltyAccountDtoSchema),
      annotations: READ,
    },
    (ctx) =>
      ({ withinDays }) =>
        runStructured(() => ctx.client.listExpiringAccounts(withinDays), true),
  ],
  [
    "pointup_get_value_advice",
    {
      title: "Bang-for-buck advice",
      description:
        "Ranked transfer/redemption ideas using the transfer-partner graph and curated deals. Estimates, not guarantees: tell the user to verify availability. Read-only.",
      inputSchema: {},
      outputSchema: valueAdviceDtoSchema.shape,
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.getValueAdvice()),
  ],
  [
    "pointup_plan_redemption",
    {
      title: "Plan the best use of my points",
      description:
        "Start here for 'how should I use my points?' / 'find me a deal'. Deterministic optimizer over the user's real balances, active transfer bonuses and a curated sweet-spot catalog: ranked plans with concrete steps (transfer X from A to B at ratio [+bonus], then book Y), points used per source program, effective cents per point, shortfall (and which program could cover it), expiry urgency, confidence and caveats. Estimates, not quotes: award availability is NOT verified unless a plan carries `availability` (only set when the user's deployment has award search configured and you pass origin/destination/dateFrom/dateTo/cabin together for a flight goal). ALWAYS relay the caveats, never promise availability or prices, and tell the user transfers are irreversible: confirm space on the provider's site first. Read-only.",
      inputSchema: {
        goalKind: z.enum(["flight", "hotel", "any"]).optional(),
        targetProgramId: idSchema
          .optional()
          .describe(
            "Program where the trip is booked, e.g. 'hyatt' (ids from pointup_list_providers)",
          ),
        minValueCpp: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("Drop plans below this effective cents-per-point"),
        quantity: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe("Nights or tickets"),
        limit: z.number().int().min(1).max(50).optional(),
        origin: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{3}$/)
          .optional(),
        destination: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{3}$/)
          .optional(),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        cabin: z
          .enum(["economy", "premium_economy", "business", "first"])
          .optional(),
      },
      outputSchema: planRedemptionResultDtoSchema.shape,
      annotations: READ,
    },
    (ctx) => (input) => runStructured(() => ctx.client.planRedemption(input)),
  ],
  [
    "pointup_list_sweet_spots",
    {
      title: "Curated award sweet spots",
      description:
        "Editorial catalog of well-known redemption patterns with TYPICAL points ranges, estimated cents per point, constraints and confidence. Every entry is unverified (`verified: false`): never quote these as live prices or availability. Read-only.",
      inputSchema: {
        kind: z.enum(["flight", "hotel", "other"]).optional(),
        programId: idSchema.optional(),
      },
      outputSchema: listOutput(sweetSpotDtoSchema),
      annotations: READ,
    },
    (ctx) => (input) =>
      runStructured(() => ctx.client.listSweetSpots(input), true),
  ],
  [
    "pointup_list_transfer_bonuses",
    {
      title: "Active transfer bonuses",
      description:
        "Currently active transfer-bonus windows (e.g. +30% Chase -> Hyatt). Crowd/manual data and EMPTY by default; each has a source (manual, scraped, user) and verifiedAt (null = unverified). Read-only.",
      inputSchema: {},
      outputSchema: listOutput(transferBonusDtoSchema),
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.listTransferBonuses(), true),
  ],
  [
    "pointup_list_goals",
    {
      title: "Trip goals and progress",
      description:
        "The user's trip goals with target points, linked accounts and progress. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(tripGoalDtoSchema),
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.listTripGoals(), true),
  ],
  [
    "pointup_list_activity",
    {
      title: "Recent activity",
      description:
        "Recent portfolio events (balance changes, links, agent write-backs), newest first (default 50, max 200). For the audit trail of agent write-backs only, use pointup_list_observations. Read-only.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      outputSchema: listOutput(activityEventDtoSchema),
      annotations: READ,
    },
    (ctx) =>
      ({ limit }) =>
        runStructured(() => ctx.client.listActivity(limit), true),
  ],
  [
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
    (ctx) => (input) => run(() => ctx.client.linkLoyaltyAccount(input)),
  ],
  [
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
    (ctx) =>
      ({ accountId, ...body }) =>
        run(() => ctx.client.recordManualBalance(accountId, body)),
  ],
  [
    "pointup_record_transfer_bonus",
    {
      title: "Report a transfer bonus",
      description:
        "Record a transfer bonus the USER has seen announced by the issuer. It is stored as user-reported and unverified, and then affects every user's plans (flagged as unverified), so only record bonuses you have a source for and include sourceUrl. The edge must exist in the transfer graph and the bonus must be greater than 0% and at most 200%.",
      inputSchema: {
        fromProviderId: idSchema.describe(
          "Source currency, e.g. chase-ultimate-rewards",
        ),
        toProviderId: idSchema.describe("Destination program, e.g. hyatt"),
        bonusPercent: z.number().positive().max(200).describe("30 means +30%"),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        sourceUrl: z.url().max(2048).optional(),
      },
      outputSchema: transferBonusDtoSchema.shape,
      annotations: WRITE,
    },
    (ctx) => (input) =>
      runStructured(() => ctx.client.recordTransferBonus(input)),
  ],
  [
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
    (ctx) => (input) => run(() => ctx.client.createTripGoal(input)),
  ],
  [
    "pointup_list_skills",
    {
      title: "List browser/computer skills",
      description:
        "Playbooks for reading a balance from a provider site in the user's own browser, with whether the program is linked and consent is active. Each skill has an 'unverified' flag: when true, its start URL is best-effort, so tell the user and stop if the page does not match. Also available as resources pointup://skills/{skillId}.",
      inputSchema: { providerId: idSchema.optional() },
      outputSchema: listOutput(agentSkillDtoSchema),
      annotations: READ,
    },
    (ctx) =>
      ({ providerId }) =>
        runStructured(() => ctx.client.listAgentSkills(providerId), true),
  ],
  [
    "pointup_request_consent",
    {
      title: "Point the user to the consent page for a program",
      description:
        "Consent can only be granted by the signed-in user on the PointUp dashboard; this tool never grants anything. It validates the program and returns the dashboard link and program name to show the user. Tell the user to grant consent there, then continue once pointup_list_skills shows consentActive.",
      inputSchema: { providerId: idSchema },
      annotations: READ,
    },
    (ctx) =>
      ({ providerId }) => {
        // Validate before echoing anything, and show catalog data only.
        const provider = PROVIDER_CATALOG.find((p) => p.id === providerId);
        if (!provider) {
          return ok({
            granted: false,
            reason: "unknown provider",
            hint: "Use an id from pointup_list_providers.",
          });
        }
        const link = `${ctx.appUrl}/dashboard/agents`;
        return ok({
          granted: false,
          providerId: provider.id,
          provider: provider.displayName,
          dashboardUrl: link,
          action: `Ask the user to open ${link} and allow agents to read their ${provider.displayName} balance. Only the user can grant consent; do not try to do it for them.`,
        });
      },
  ],
  [
    "pointup_submit_balance",
    {
      title: "Write back a balance read from a provider site",
      description:
        "Submit the points balance you read from the user's own signed-in provider page. Requires an active consent for the program (see pointup_request_consent) and a sourceUrl on the skill's allowed hosts. Outcome 'needs_review' means the value looks implausible and was NOT saved: the result carries a reviewId, and the user must confirm or reject it on the dashboard (Dashboard > Agents). You cannot confirm it; resubmitting does not help. Auto-linking an unlinked program (membershipNumber) needs a token with portfolio:write.",
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
      },
      annotations: WRITE,
    },
    (ctx) => (input) =>
      run(() =>
        ctx.client.submitObservation({ ...input, agent: ctx.agentName }),
      ),
  ],
  [
    "pointup_list_observations",
    {
      title: "Audit trail of agent write-backs",
      description:
        "Audit trail of balances agents wrote back (provider, skill, agent, source host, outcome). The source host is stored, never the full URL. Use it to confirm a pointup_submit_balance landed. Read-only.",
      inputSchema: {},
      outputSchema: listOutput(agentObservationDtoSchema),
      annotations: READ,
    },
    (ctx) => () => runStructured(() => ctx.client.listObservations(), true),
  ],
];

/**
 * Raw zod shapes are compiled to z.object() here, once. Handing the SDK a raw
 * shape would make it rebuild the object schema on every registration, i.e.
 * once per tool per request (the stateless server is created per request).
 */
function compileShape(shape: unknown): z.ZodObject | undefined {
  return shape ? z.object(shape as z.ZodRawShape) : undefined;
}

const TOOL_DEFS: readonly ToolDef[] = RAW_TOOL_DEFS.map(
  ([name, config, bind]) => {
    const { inputSchema, outputSchema, ...rest } = config;
    return [
      name,
      {
        ...rest,
        inputSchema: compileShape(inputSchema ?? {}),
        ...(outputSchema ? { outputSchema: compileShape(outputSchema) } : {}),
      },
      bind,
    ] as const;
  },
);

const CAPTURE_BALANCE_ARGS = { providerId: idSchema };
const FIND_DEALS_ARGS = { goal: z.string().max(200).optional() };

export function createPointUpMcpServer(options: ServerOptions): McpServer {
  const { client, appUrl, agentName, requestId, observability } = options;
  const server = new McpServer(
    { name: "pointup", version: "1.0.0" },
    {
      instructions: [
        "PointUp tracks the user's loyalty points (airline, hotel, card, rail, shopping).",
        "Reading is always allowed with a portfolio:read token.",
        "To read a balance from a provider website with a browser/computer agent, follow the flow: pointup_list_skills → confirm consent is active (only the user can grant it, on the dashboard; pointup_request_consent just returns the link) → read the page in the user's own signed-in browser → pointup_submit_balance.",
        "For 'how should I use my points?' call pointup_plan_redemption and always relay its caveats: plans are estimates and award availability is NOT verified unless a plan carries availability data.",
        "Never ask for, type, or store the user's loyalty passwords.",
      ].join(" "),
    },
  );

  // Every tool gets a span, log line and metric without touching each handler.
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    callback: (...args: unknown[]) => unknown,
  ) => unknown;
  const ctx: ToolContext = { client, appUrl, agentName };

  for (const [name, config, bind] of TOOL_DEFS) {
    registerTool(
      name,
      config,
      instrumentTool(name, bind(ctx), requestId, observability),
    );
  }

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
      const skill = (await client.listAgentSkills()).find(
        (s) => s.id === skillId,
      );
      if (!skill) throw new Error(`Unknown skill "${skillId}"`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderSkillPlaybook(skill),
          },
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
      argsSchema: CAPTURE_BALANCE_ARGS,
    },
    async ({ providerId }) => {
      const skills = await client.listAgentSkills(providerId);
      const skill = skills.find((s) => s.mode === "browser") ?? skills[0];
      const text = skill
        ? renderSkillPlaybook(skill)
        : `No skill exists for "${providerId}". Use pointup_list_providers to check the id.`;
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    },
  );

  server.registerPrompt(
    "portfolio-review",
    {
      title: "Review my points portfolio",
      description:
        "Summarize balances, expiring points, goals, and best redemptions.",
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

  server.registerPrompt(
    "find-deals",
    {
      title: "Find deals and optimally use my points",
      description: "Plan the best redemptions for my balances, honestly.",
      argsSchema: FIND_DEALS_ARGS,
    },
    ({ goal }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Find deals and the best way to use my points${goal ? ` (${goal})` : ""}. Call pointup_plan_redemption (set goalKind/targetProgramId if I named a trip), also pointup_list_transfer_bonuses, and give me the top 3 plans with the exact transfer steps, the effective cents per point, anything expiring, and every caveat. Do not claim award availability unless a plan carries availability data.`,
          },
        },
      ],
    }),
  );

  return server;
}
