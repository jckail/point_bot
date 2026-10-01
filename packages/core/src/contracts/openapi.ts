import { z } from "zod";

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
import {
  planRedemptionResultDtoSchema,
  recordTransferBonusRequestSchema,
  sweetSpotDtoSchema,
  transferBonusDtoSchema,
} from "./optimizer";
import {
  accessTokenDtoSchema,
  agentObservationDtoSchema,
  agentSkillDtoSchema,
  consentDtoSchema,
  createAccessTokenRequestSchema,
  createdAccessTokenDtoSchema,
  grantConsentRequestSchema,
  observationResultDtoSchema,
  submitObservationRequestSchema,
} from "./agent";

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
  ProviderDto: providerDtoSchema,
  LoyaltyAccountDto: loyaltyAccountDtoSchema,
  BalanceDto: balanceDtoSchema,
  PortfolioSummaryDto: portfolioSummaryDtoSchema,
  PortfolioExportDto: portfolioExportDtoSchema,
  ActivityEventDto: activityEventDtoSchema,
  TripGoalDto: tripGoalDtoSchema,
  SyncOutcomeDto: syncOutcomeDtoSchema,
  ValueAdviceDto: valueAdviceDtoSchema,
  PlanRedemptionResultDto: planRedemptionResultDtoSchema,
  SweetSpotDto: sweetSpotDtoSchema,
  TransferBonusDto: transferBonusDtoSchema,
  RecordTransferBonusRequest: recordTransferBonusRequestSchema,
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
  AccessTokenDto: accessTokenDtoSchema,
  CreateAccessTokenRequest: createAccessTokenRequestSchema,
  CreatedAccessTokenDto: createdAccessTokenDtoSchema,
  ConsentDto: consentDtoSchema,
  GrantConsentRequest: grantConsentRequestSchema,
  AgentSkillDto: agentSkillDtoSchema,
  SubmitObservationRequest: submitObservationRequestSchema,
  ObservationResultDto: observationResultDtoSchema,
  AgentObservationDto: agentObservationDtoSchema,
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
  "401": jsonResponse("Not authenticated", ref("ApiError")),
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
    }) as Json;
    delete jsonSchema.$schema;
    schemas[name] = jsonSchema;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "PointUp API",
      version: options.version ?? "1.0.0",
      description:
        "Versioned HTTP API for PointUp / PointBot. Generated from the zod wire contracts (@pointup/core/contracts).",
    },
    servers: [{ url: options.serverUrl ?? "/" }],
    security: [{ clerkSession: [] }, { accessToken: [] }],
    components: {
      securitySchemes: {
        accessToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "pu_...",
          description:
            "PointUp personal access token (create one in Settings or POST /api/v1/tokens). Used by the MCP server, ChatGPT Actions, and scripts. Scoped: portfolio:read, portfolio:write, observations:write, consents:manage (revoke consent only; granting is session-only).",
        },
        clerkSession: {
          type: "http",
          scheme: "bearer",
          description:
            "Clerk session. Browsers send the session cookie automatically; native surfaces send Authorization: Bearer <token>.",
        },
      },
      schemas,
    },
    paths: {
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
          summary: "Balance history, newest first",
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 365 },
            },
          ],
          responses: {
            "200": jsonResponse("Balance snapshots", arrayOf("BalanceDto")),
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
            "200": jsonResponse("Sync outcome", ref("SyncOutcomeDto")),
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
      "/api/v1/optimizer/plan": {
        get: {
          summary: "Ranked redemption plans for the caller's points",
          description:
            "Deterministic optimizer over balances, active transfer bonuses and curated sweet spots. Estimates only: availability is NOT verified unless a plan has `availability` (award search must be configured). Every plan lists caveats and a confidence.",
          parameters: [
            { name: "goalKind", in: "query", schema: { type: "string", enum: ["flight", "hotel", "any"] } },
            { name: "targetProgramId", in: "query", schema: { type: "string" } },
            { name: "minValueCpp", in: "query", schema: { type: "number" } },
            { name: "quantity", in: "query", schema: { type: "integer", minimum: 1, maximum: 30 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
            { name: "origin", in: "query", schema: { type: "string" }, description: "IATA code; with destination, dateFrom, dateTo, cabin runs a live award search (flight goals)." },
            { name: "destination", in: "query", schema: { type: "string" } },
            { name: "dateFrom", in: "query", schema: { type: "string" } },
            { name: "dateTo", in: "query", schema: { type: "string" } },
            { name: "cabin", in: "query", schema: { type: "string", enum: ["economy", "premium_economy", "business", "first"] } },
          ],
          responses: {
            "200": jsonResponse("Redemption plans", ref("PlanRedemptionResultDto")),
            "422": jsonResponse("Invalid goal", ref("ApiError")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/deals/sweet-spots": {
        get: {
          summary: "Curated award sweet-spot catalog",
          description:
            "Editorial, unverified redemption patterns with typical points ranges. Never live prices or availability.",
          parameters: [
            { name: "kind", in: "query", schema: { type: "string", enum: ["flight", "hotel", "other"] } },
            { name: "programId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": jsonResponse("Sweet spots", arrayOf("SweetSpotDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/transfer-bonuses": {
        get: {
          summary: "Active transfer bonuses",
          description:
            "Crowd/manual data, empty by default. Each bonus has a source (manual, scraped, user) and may be unverified.",
          responses: {
            "200": jsonResponse("Active bonuses", arrayOf("TransferBonusDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          summary: "Report a transfer bonus",
          description:
            "Needs portfolio:write. Stored as source=user, unverified, and used in every user's plans (flagged user-reported): only report bonuses you saw announced.",
          requestBody: body("RecordTransferBonusRequest"),
          responses: {
            "201": jsonResponse("Recorded bonus", ref("TransferBonusDto")),
            "422": jsonResponse("Invalid bonus", ref("ApiError")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/deals/scrape": {
        post: {
          summary: "Scrape a deal page and re-rank advice",
          requestBody: body("ScrapeDealRequest"),
          responses: {
            "200": jsonResponse("Scrape result", ref("IngestDealPageResultDto")),
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
      "/api/v1/skills": {
        get: {
          operationId: "listAgentSkills",
          summary: "List agent skills (browser/computer playbooks) with this user's link + consent state",
          parameters: [
            { name: "providerId", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: {
            "200": jsonResponse("Skills", arrayOf("AgentSkillDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/consents": {
        get: {
          operationId: "listConsents",
          summary: "List agent consents",
          responses: {
            "200": jsonResponse("Consents", arrayOf("ConsentDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          operationId: "grantConsent",
          summary: "Grant time-boxed consent for agents to read one program and write balances back (session auth only: tokens cannot grant)",
          requestBody: body("GrantConsentRequest"),
          responses: {
            "201": jsonResponse("Granted consent", ref("ConsentDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/consents/{id}": {
        parameters: [ID_PARAM],
        delete: {
          operationId: "revokeConsent",
          summary: "Revoke a consent immediately",
          responses: {
            "204": { description: "Revoked" },
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/agent/observations": {
        get: {
          operationId: "listObservations",
          summary: "Audit trail of what agents wrote back",
          responses: {
            "200": jsonResponse("Observations", arrayOf("AgentObservationDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          operationId: "submitObservation",
          summary: "Write back a balance an agent read from the user's own browser (requires active consent)",
          requestBody: body("SubmitObservationRequest"),
          responses: {
            "200": jsonResponse("Outcome (recorded, unchanged, or needs_review with a reviewId only the signed-in user can resolve)", ref("ObservationResultDto")),
            "403": jsonResponse("Missing scope or no active consent", ref("ApiError")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/agent/observations/{id}/confirm": {
        parameters: [ID_PARAM],
        post: {
          operationId: "confirmObservationReview",
          summary: "Confirm a held reading and write it (session auth only; single-use, expires after 24h)",
          responses: {
            "200": jsonResponse("Recorded", ref("ObservationResultDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/agent/observations/{id}/reject": {
        parameters: [ID_PARAM],
        post: {
          operationId: "rejectObservationReview",
          summary: "Discard a held reading (session auth only)",
          responses: {
            "200": jsonResponse("Rejected", ref("ObservationResultDto")),
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
          },
        },
      },
      "/api/v1/tokens": {
        get: {
          operationId: "listAccessTokens",
          summary: "List personal access tokens (never returns secrets)",
          responses: {
            "200": jsonResponse("Tokens", arrayOf("AccessTokenDto")),
            ...ERROR_RESPONSES,
          },
        },
        post: {
          operationId: "createAccessToken",
          summary: "Create a personal access token (session auth only; secret shown once)",
          requestBody: body("CreateAccessTokenRequest"),
          responses: {
            "201": jsonResponse("Created token", ref("CreatedAccessTokenDto")),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/tokens/{id}": {
        parameters: [ID_PARAM],
        delete: {
          operationId: "revokeAccessToken",
          summary: "Revoke a token",
          responses: {
            "204": { description: "Revoked" },
            ...ERROR_RESPONSES,
            ...NOT_FOUND,
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
}
