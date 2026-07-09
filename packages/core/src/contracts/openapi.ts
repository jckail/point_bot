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
    security: [{ clerkSession: [] }],
    components: {
      securitySchemes: {
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
        post: {
          summary: "Record a manual balance",
          requestBody: body("RecordManualBalanceRequest"),
          responses: {
            "201": jsonResponse("Updated account", ref("LoyaltyAccountDto")),
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
}
