import { z } from "zod";
import {
  agentTokenDtoSchema,
  agentConsentDtoSchema,
  agentObservationDtoSchema,
  mintAgentTokenRequestSchema,
  grantAgentConsentRequestSchema,
  submitAgentObservationRequestSchema,
  reviewAgentObservationRequestSchema,
} from "./agents";
import { assistantActionDtoSchema, assistantActionProposalRequestSchema } from "../domain/assistant/actions";

import {
  activityEventDtoSchema,
  apiErrorSchema,
  balanceDtoSchema,
  bulkUpdateMembershipRequestSchema,
  bulkUpdateMembershipResultDtoSchema,
  chatAssistantRequestSchema,
  chatAssistantResponseSchema,
  createPortfolioShareRequestSchema,
  createTripGoalRequestSchema,
  awardWatchDtoSchema,
  createAwardWatchRequestSchema,
  customValuationDtoSchema,
  deletedAccountDtoSchema,
  setCustomValuationRequestSchema,
  updateUserSettingsRequestSchema,
  userSettingsDtoSchema,
  importPortfolioRequestSchema,
  importPortfolioResultDtoSchema,
  ingestDealPageResultDtoSchema,
  linkLoyaltyAccountRequestSchema,
  loyaltyAccountDtoSchema,
  portfolioExportDtoSchema,
  portfolioShareDtoSchema,
  portfolioSummaryDtoSchema,
  providerDtoSchema,
  providerCapabilitiesDtoSchema,
  publicPortfolioSnapshotDtoSchema,
  recordManualBalanceRequestSchema,
  scrapeDealRequestSchema,
  syncLoyaltyAccountRequestSchema,
  syncOutcomeDtoSchema,
  tripGoalDtoSchema,
  updateLoyaltyAccountRequestSchema,
  updateTripGoalRequestSchema,
  valueAdviceDtoSchema,
} from "./index";

/**
 * OpenAPI 3.1 document generated from the zod wire contracts — the same schemas
 * the server validates against and `@pointup/api-client` is typed from. The
 * component schemas are produced by `z.toJSONSchema` (JSON Schema 2020-12, which
 * OpenAPI 3.1 adopts wholesale), so they cannot drift from the runtime
 * validators. Paths are a thin hand-authored map over those components.
 *
 * Framework-free and dependency-light (only zod) so any surface can serve it —
 * the web app exposes it at `GET /api/v1/openapi.json`.
 */

/** Named component schemas → their zod source. */
const COMPONENT_SCHEMAS = {
  AgentTokenDto: agentTokenDtoSchema,
  AgentConsentDto: agentConsentDtoSchema,
  AgentObservationDto: agentObservationDtoSchema,
  MintAgentTokenRequest: mintAgentTokenRequestSchema,
  MintAgentTokenResponse: z.object({ token: z.string(), metadata: agentTokenDtoSchema }),
  GrantAgentConsentRequest: grantAgentConsentRequestSchema,
  SubmitAgentObservationRequest: submitAgentObservationRequestSchema,
  ReviewAgentObservationRequest: reviewAgentObservationRequestSchema,
  RevokeAgentCredentialResponse: z.object({ revoked: z.literal(true) }),
  AssistantActionDto: assistantActionDtoSchema,
  AssistantActionProposalRequest: assistantActionProposalRequestSchema,
  AssistantActionsResponse: z.object({ actions: z.array(assistantActionDtoSchema) }),
  AssistantActionResponse: z.object({ action: assistantActionDtoSchema }),
  AssistantActionDecisionRequest: z.object({}).strict(),
  ScrapeDealResponse: z.object({ ingest: ingestDealPageResultDtoSchema, advice: valueAdviceDtoSchema }),
  ProviderDto: providerDtoSchema,
  ProviderCapabilitiesDto: providerCapabilitiesDtoSchema,
  LoyaltyAccountDto: loyaltyAccountDtoSchema,
  BalanceDto: balanceDtoSchema,
  PortfolioSummaryDto: portfolioSummaryDtoSchema,
  PortfolioExportDto: portfolioExportDtoSchema,
  ActivityEventDto: activityEventDtoSchema,
  TripGoalDto: tripGoalDtoSchema,
  SyncOutcomeDto: syncOutcomeDtoSchema,
  ValueAdviceDto: valueAdviceDtoSchema,
  DeletedAccountDto: deletedAccountDtoSchema,
  PortfolioShareDto: portfolioShareDtoSchema,
  PublicPortfolioSnapshotDto: publicPortfolioSnapshotDtoSchema,
  IngestDealPageResultDto: ingestDealPageResultDtoSchema,
  ChatAssistantResponse: chatAssistantResponseSchema,
  ImportPortfolioResultDto: importPortfolioResultDtoSchema,
  BulkUpdateMembershipResultDto: bulkUpdateMembershipResultDtoSchema,
  CustomValuationDto: customValuationDtoSchema,
  AwardWatchDto: awardWatchDtoSchema,
  CreateAwardWatchRequest: createAwardWatchRequestSchema,
  UserSettingsDto: userSettingsDtoSchema,
  UpdateUserSettingsRequest: updateUserSettingsRequestSchema,
  SetCustomValuationRequest: setCustomValuationRequestSchema,
  ApiError: apiErrorSchema,
  LinkLoyaltyAccountRequest: linkLoyaltyAccountRequestSchema,
  UpdateLoyaltyAccountRequest: updateLoyaltyAccountRequestSchema,
  BulkUpdateMembershipRequest: bulkUpdateMembershipRequestSchema,
  RecordManualBalanceRequest: recordManualBalanceRequestSchema,
  SyncLoyaltyAccountRequest: syncLoyaltyAccountRequestSchema,
  CreateTripGoalRequest: createTripGoalRequestSchema,
  UpdateTripGoalRequest: updateTripGoalRequestSchema,
  ImportPortfolioRequest: importPortfolioRequestSchema,
  ChatAssistantRequest: chatAssistantRequestSchema,
  ScrapeDealRequest: scrapeDealRequestSchema,
  CreatePortfolioShareRequest: createPortfolioShareRequestSchema,
} as const satisfies Record<string, z.ZodType>;

type ComponentName = keyof typeof COMPONENT_SCHEMAS;

type Json = Record<string, unknown>;

function ref(name: ComponentName): Json {
  return { $ref: `#/components/schemas/${name}` };
}
function arrayOf(name: ComponentName): Json {
  return { type: "array", items: ref(name) };
}
function jsonContent(schema: Json): Json {
  return { "application/json": { schema } };
}
function body(name: ComponentName, required = true): Json {
  return { required, content: jsonContent(ref(name)) };
}
function jsonResponse(description: string, schema: Json): Json {
  return { description, content: jsonContent(schema) };
}

/** Standard error responses shared by authenticated JSON endpoints. */
const ERROR_RESPONSES: Json = {
  "400": jsonResponse("Request failed schema validation", ref("ApiError")),
  "401": jsonResponse("Not authenticated, or token invalid/revoked/expired", ref("ApiError")),
  "403": jsonResponse("Required scope, program consent, browser session or same-origin mutation authority missing", ref("ApiError")),
  "413": jsonResponse("Request body exceeds 2 MiB", ref("ApiError")),
  "415": jsonResponse("Use application/json for request bodies", ref("ApiError")),
};
const NOT_FOUND: Json = {
  "404": jsonResponse("Not found or not owned by the caller", ref("ApiError")),
};

/** A single-item id path parameter. */
const ID_PARAM: Json = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

export interface BuildOpenApiOptions {
  /** e.g. "https://app.example.com"; defaults to a relative server. */
  readonly serverUrl?: string;
  readonly version?: string;
}

export function buildOpenApiDocument(options: BuildOpenApiOptions = {}): Json {
  const schemas: Json = {};
  for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
    const jsonSchema = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io: name.endsWith("Request") ? "input" : "output",
    }) as Json;
    delete jsonSchema.$schema;
    schemas[name] = jsonSchema;
  }

  const document: Json = {
    openapi: "3.1.0",
    info: {
      title: "PointUp API",
      version: options.version ?? "1.0.0",
      description:
        "Versioned HTTP API for PointUp / PointBot. Generated from the zod wire contracts (@pointup/core/contracts).",
    },
    servers: [{ url: options.serverUrl ?? "/" }],
    security: [{ clerkSession: [] }],
    components: {
      securitySchemes: {
        clerkCookie: {
          type: "apiKey", in: "cookie", name: "__session",
          description: "First-party Clerk browser cookie. Management/approval operations reject every Authorization header and require same-origin Origin on mutations.",
        },
        agentToken: {
          type: "http", scheme: "bearer", bearerFormat: "pu_ PAT",
          description: "User-minted scoped PointUp PAT. Invalid/revoked/expired PATs fail closed without cookie fallback. Required scopes are documented by x-pointup-required-scopes; program consent is separately required for observations.",
        },
        clerkSession: {
          type: "http",
          scheme: "bearer",
          description:
            "Clerk session JWT sent as Authorization: Bearer <token>. Not accepted at browser-session-only management or approval endpoints.",
        },
      },
      schemas,
    },
    paths: {
      "/api/v1/agents/tokens": {
        get: { operationId: "listAgentTokens", summary: "List token metadata (browser session only)", responses: { "200": jsonResponse("Token metadata; never hashes/plaintext", arrayOf("AgentTokenDto")), ...ERROR_RESPONSES } },
        post: { operationId: "mintAgentToken", summary: "Mint a scoped token (browser session only)", description: "Maximum lifetime 90 days. Plaintext token appears once; never expose it to an agent automatically.", requestBody: body("MintAgentTokenRequest"), responses: { "201": jsonResponse("One-time token and metadata", ref("MintAgentTokenResponse")), ...ERROR_RESPONSES, "422": jsonResponse("Invalid token policy", ref("ApiError")) } },
      },
      "/api/v1/agents/tokens/{id}": {
        parameters: [{ ...ID_PARAM, schema: { type: "string", format: "uuid" } }],
        delete: { operationId: "revokeAgentToken", summary: "Revoke an owned token (browser session only)", responses: { "200": jsonResponse("Revoked", ref("RevokeAgentCredentialResponse")), ...ERROR_RESPONSES, ...NOT_FOUND } },
      },
      "/api/v1/agents/consents": {
        get: { operationId: "listAgentConsents", summary: "List account/program observation consents (browser session only)", responses: { "200": jsonResponse("Consent metadata", arrayOf("AgentConsentDto")), ...ERROR_RESPONSES } },
        post: { operationId: "grantAgentConsent", summary: "Grant account-bound observation consent (browser session only)", description: "Maximum lifetime 30 days. Provider derives from owned account. Agents cannot grant themselves consent.", requestBody: body("GrantAgentConsentRequest"), responses: { "201": jsonResponse("Consent metadata", ref("AgentConsentDto")), ...ERROR_RESPONSES, ...NOT_FOUND, "422": jsonResponse("Invalid consent policy", ref("ApiError")) } },
      },
      "/api/v1/agents/consents/{id}": {
        parameters: [{ ...ID_PARAM, schema: { type: "string", format: "uuid" } }],
        delete: { operationId: "revokeAgentConsent", summary: "Revoke account consent (browser session only)", responses: { "200": jsonResponse("Revoked", ref("RevokeAgentCredentialResponse")), ...ERROR_RESPONSES, ...NOT_FOUND } },
      },
      "/api/v1/agents/observations": {
        get: { operationId: "listAgentObservations", summary: "List observations for user review (browser session only)", responses: { "200": jsonResponse("Observation metadata", arrayOf("AgentObservationDto")), ...ERROR_RESPONSES } },
        post: { operationId: "submitAgentObservation", summary: "Submit a consent-bound observation (PAT only)", description: "Requires observations:write plus active account/program consent. Server derives userId/tokenId. Same UUID/payload is idempotent; changed payload conflicts. Anomalies are held for browser review.", security: [{ agentToken: [] }], "x-pointup-required-scopes": ["observations:write"], requestBody: body("SubmitAgentObservationRequest"), responses: { "200": jsonResponse("Accepted or previously reviewed observation", ref("AgentObservationDto")), "202": jsonResponse("Held for browser review", ref("AgentObservationDto")), ...ERROR_RESPONSES, ...NOT_FOUND, "409": jsonResponse("Observation UUID payload conflict", ref("ApiError")), "422": jsonResponse("Invalid observation policy", ref("ApiError")) } },
      },
      "/api/v1/agents/observations/{id}/review": {
        parameters: [{ ...ID_PARAM, schema: { type: "string", format: "uuid" } }],
        post: { operationId: "reviewAgentObservation", summary: "Approve or reject a held observation (browser session only)", requestBody: body("ReviewAgentObservationRequest"), responses: { "200": jsonResponse("Reviewed observation", ref("AgentObservationDto")), ...ERROR_RESPONSES, ...NOT_FOUND, "409": jsonResponse("Observation cannot be reviewed", ref("ApiError")) } },
      },
      "/api/v1/assistant/actions": {
        get: { operationId: "listAssistantActions", summary: "List staged actions (browser session only)", responses: { "200": jsonResponse("Actions envelope", ref("AssistantActionsResponse")), ...ERROR_RESPONSES } },
        post: { operationId: "proposeAssistantAction", summary: "Propose an action for user review", description: "Proposal only; does not execute. Owner, account/program labels, status and expiry are server-bound. The assistant MCP exposes proposals rather than direct goal/balance mutations.", requestBody: body("AssistantActionProposalRequest"), responses: { "201": jsonResponse("Action envelope", ref("AssistantActionResponse")), ...ERROR_RESPONSES, ...NOT_FOUND } },
      },
      "/api/v1/assistant/actions/{actionId}/approve": {
        parameters: [{ name: "actionId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 255 } }],
        post: { operationId: "approveAssistantAction", summary: "Approve and execute a staged action (browser session only)", description: "Agents/PATs cannot approve. Execution claim is one-time; unknown/failed executions are never blindly retried.", requestBody: body("AssistantActionDecisionRequest"), responses: { "200": jsonResponse("Action envelope including final status", ref("AssistantActionResponse")), ...ERROR_RESPONSES, ...NOT_FOUND } },
      },
      "/api/v1/assistant/actions/{actionId}/reject": {
        parameters: [{ name: "actionId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 255 } }],
        post: { operationId: "rejectAssistantAction", summary: "Reject a staged action (browser session only)", requestBody: body("AssistantActionDecisionRequest"), responses: { "200": jsonResponse("Action envelope", ref("AssistantActionResponse")), ...ERROR_RESPONSES, ...NOT_FOUND } },
      },
      "/api/health": {
        get: {
          summary: "Liveness check",
          security: [],
          responses: {
            "200": jsonResponse("Service is up", {
              type: "object",
              properties: { status: { type: "string" } },
              required: ["status"],
            }),
          },
        },
      },
      "/api/v1/providers": {
        get: {
          summary: "List supported loyalty programs",
          security: [],
          responses: { "200": jsonResponse("Provider catalog", arrayOf("ProviderDto")) },
        },
      },
      "/api/v1/summary": {
        get: {
          summary: "Portfolio summary",
          responses: {
            "200": jsonResponse("Aggregated portfolio", ref("PortfolioSummaryDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/loyalty-accounts": {
        get: {
          summary: "List the caller's accounts",
          responses: {
            "200": jsonResponse("Accounts", arrayOf("LoyaltyAccountDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          summary: "Link a loyalty account",
          requestBody: body("LinkLoyaltyAccountRequest"),
          responses: {
            "201": jsonResponse("Created", {
              type: "object",
              properties: { accountId: { type: "string" } },
              required: ["accountId"],
            }),
            ...ERROR_RESPONSES,
          },
        },
        patch: {
          summary: "Bulk-edit membership numbers",
          requestBody: body("BulkUpdateMembershipRequest"),
          responses: {
            "200": jsonResponse("Per-item outcome", ref("BulkUpdateMembershipResultDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/loyalty-accounts/{id}": {
        parameters: [ID_PARAM],
        get: {
          summary: "Get one account",
          responses: {
            "200": jsonResponse("Account", ref("LoyaltyAccountDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
        patch: {
          summary: "Update one account",
          requestBody: body("UpdateLoyaltyAccountRequest"),
          responses: {
            "200": jsonResponse("Updated account", ref("LoyaltyAccountDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
        delete: {
          summary: "Unlink one account",
          responses: {
            "204": { description: "Unlinked" },
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/loyalty-accounts/{id}/balances": {
        parameters: [ID_PARAM],
        get: {
          summary: "Read balance history, newest first",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 50 } }],
          responses: {
            "200": jsonResponse("Balance history", arrayOf("BalanceDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
        post: {
          summary: "Record a manual balance",
          requestBody: body("RecordManualBalanceRequest"),
          responses: {
            "201": jsonResponse("Recorded balance", ref("BalanceDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/loyalty-accounts/{id}/sync": {
        parameters: [ID_PARAM],
        post: {
          summary: "Sync one account",
          requestBody: { required: false, content: jsonContent(ref("SyncLoyaltyAccountRequest")) },
          responses: {
            "200": jsonResponse("Synced balance", ref("BalanceDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/sync": {
        post: {
          summary: "Sync all accounts",
          responses: {
            "200": jsonResponse("Per-account outcomes", arrayOf("SyncOutcomeDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/activity": {
        get: {
          summary: "Recent activity feed",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": jsonResponse("Activity events", arrayOf("ActivityEventDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/expiring": {
        get: {
          summary: "Accounts expiring soon",
          responses: {
            "200": jsonResponse("Expiring accounts", arrayOf("LoyaltyAccountDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/export": {
        get: {
          summary: "Export accounts + history (json or csv)",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } },
          ],
          responses: {
            "200": {
              description: "Portfolio export",
              content: {
                "application/json": { schema: ref("PortfolioExportDto") },
                "text/csv": { schema: { type: "string" } },
              },
            },
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/import": {
        post: {
          summary: "Import accounts + balances from a CSV export",
          requestBody: body("ImportPortfolioRequest"),
          responses: {
            "201": jsonResponse("Import result", ref("ImportPortfolioResultDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/calendar.ics": {
        get: {
          summary: "iCalendar feed of expiration dates",
          responses: {
            "200": {
              description: "iCalendar document",
              content: { "text/calendar": { schema: { type: "string" } } },
            },
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/goals": {
        get: {
          summary: "List trip goals",
          responses: {
            "200": jsonResponse("Trip goals", arrayOf("TripGoalDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          summary: "Create a trip goal",
          requestBody: body("CreateTripGoalRequest"),
          responses: {
            "201": jsonResponse("Created goal", ref("TripGoalDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/goals/{id}": {
        parameters: [ID_PARAM],
        patch: {
          summary: "Update a trip goal",
          requestBody: body("UpdateTripGoalRequest"),
          responses: {
            "200": jsonResponse("Updated goal", ref("TripGoalDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
        delete: {
          summary: "Delete a trip goal",
          responses: {
            "204": { description: "Deleted" },
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/demo": {
        post: {
          summary: "Seed a demo portfolio",
          responses: {
            "201": jsonResponse("Seed result", {
              type: "object",
              properties: {
                accountIds: { type: "array", items: { type: "string" } },
                goalId: { type: "string" },
              },
            }),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/assistant/chat": {
        post: {
          summary: "Grounded portfolio assistant chat",
          requestBody: body("ChatAssistantRequest"),
          responses: {
            "200": jsonResponse("Assistant reply", ref("ChatAssistantResponse")),
            "429": {
              ...jsonResponse("Assistant admission limit reached", ref("ApiError")),
              headers: { "Retry-After": { description: "Seconds before retrying", schema: { type: "integer", minimum: 1 } } },
            },
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/value-advice": {
        get: {
          summary: "Transfer + deal value advice",
          responses: {
            "200": jsonResponse("Value advice", ref("ValueAdviceDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/deals/scrape": {
        post: {
          summary: "Scrape a deal page and re-rank advice",
          requestBody: body("ScrapeDealRequest"),
          responses: {
            "201": jsonResponse("Ingested deals and updated advice", ref("ScrapeDealResponse")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/shares": {
        get: {
          summary: "List share links",
          responses: {
            "200": jsonResponse("Share links", arrayOf("PortfolioShareDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          summary: "Create a share link",
          requestBody: body("CreatePortfolioShareRequest", false),
          responses: {
            "201": jsonResponse("Created share", ref("PortfolioShareDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/shares/{id}": {
        parameters: [ID_PARAM],
        delete: {
          summary: "Revoke a share link",
          responses: {
            "204": { description: "Revoked" },
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/public/share/{token}": {
        parameters: [
          { name: "token", in: "path", required: true, schema: { type: "string" } },
        ],
        get: {
          summary: "Public portfolio snapshot for a share token",
          security: [],
          responses: {
            "200": jsonResponse("Public snapshot", ref("PublicPortfolioSnapshotDto")),
            "404": jsonResponse("Token missing, revoked, or expired", ref("ApiError")),
          },
        },
      },
      "/api/v1/valuations": {
        get: {
          summary: "List the caller's custom cents-per-point overrides",
          responses: {
            "200": jsonResponse("Custom valuations", arrayOf("CustomValuationDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/valuations/{providerId}": {
        parameters: [
          { name: "providerId", in: "path", required: true, schema: { type: "string" } },
        ],
        put: {
          summary: "Set a custom cents-per-point override for a provider",
          requestBody: body("SetCustomValuationRequest"),
          responses: {
            "200": jsonResponse("Saved override", ref("CustomValuationDto")),
            ...ERROR_RESPONSES,
          },
        },
        delete: {
          summary: "Clear a custom override (revert to editorial)",
          responses: {
            "204": { description: "Cleared" },
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/settings": {
        get: {
          summary: "Get display settings (currency)",
          responses: {
            "200": jsonResponse("User settings", ref("UserSettingsDto")),
            ...ERROR_RESPONSES,
          },
        },
        put: {
          summary: "Set the display currency",
          requestBody: body("UpdateUserSettingsRequest"),
          responses: {
            "200": jsonResponse("Saved settings", ref("UserSettingsDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/watches": {
        get: {
          summary: "List award watches",
          responses: {
            "200": jsonResponse("Award watches", arrayOf("AwardWatchDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          summary: "Watch an award/deal page for value improvements",
          requestBody: body("CreateAwardWatchRequest"),
          responses: {
            "201": jsonResponse("Created watch", ref("AwardWatchDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/watches/{id}": {
        parameters: [ID_PARAM],
        delete: {
          summary: "Stop watching a page",
          responses: {
            "204": { description: "Deleted" },
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/loyalty-accounts/deleted": {
        get: {
          summary: "Recently unlinked accounts (restore window)",
          responses: {
            "200": jsonResponse("Deleted accounts", arrayOf("DeletedAccountDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/loyalty-accounts/{id}/restore": {
        parameters: [ID_PARAM],
        post: {
          summary: "Restore a soft-deleted account",
          responses: {
            "200": jsonResponse("Restored account", ref("LoyaltyAccountDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
    },
  };
  // Mirror the HTTP guards. Bearer scheme scope lists remain empty per OpenAPI;
  // the explicit extension records PointUp's non-OAuth PAT scopes.
  const paths = document.paths as Record<string, Record<string, Json>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      operation.operationId ??= method + path.replace(/^\/api(?:\/v1)?/, "").split("/").filter(Boolean).map(part => part.replace(/[{}.-]/g, "_").split("_").filter(Boolean).map(word => word[0]!.toUpperCase() + word.slice(1)).join("")).join("");
      if (Array.isArray(operation.security) && operation.security.length === 0) continue;
      const agentManagement = path.startsWith("/api/v1/agents/") && !(path === "/api/v1/agents/observations" && method === "post");
      const actionReview = path.startsWith("/api/v1/assistant/actions") && !(path === "/api/v1/assistant/actions" && method === "post");
      const directBalance = method !== "get" && (path.endsWith("/balances") || path.endsWith("/sync") || ["/api/v1/import", "/api/v1/demo"].includes(path));
      const sharing = method !== "get" && path.startsWith("/api/v1/shares");
      if (agentManagement || actionReview || directBalance || sharing) {
        operation.security = [{ clerkCookie: [] }];
        operation["x-pointup-browser-session-only"] = true;
        operation.description = `${operation.description ?? ""} Requires a first-party Clerk cookie; every Authorization header is rejected. Mutations require same-origin Origin.`.trim();
      } else if (!operation.security) {
        const scope = method === "get" ? "portfolio:read" : path === "/api/v1/assistant/actions" ? "actions:propose" : ["/api/v1/assistant/chat", "/api/v1/deals/scrape"].includes(path) ? "assistant:chat" : "portfolio:write";
        operation.security = [{ clerkCookie: [] }, { clerkSession: [] }, { agentToken: [] }];
        operation["x-pointup-required-scopes"] = [scope];
      }
    }
  }
  return document;
}
