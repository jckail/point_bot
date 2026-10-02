import { z } from "zod";

/** Browser-safe agent wire contracts; internal models retain Date values. */
export const AGENT_SCOPES = ["portfolio:read", "portfolio:write", "observations:write", "sync:execute", "shares:write", "assistant:chat", "actions:propose"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
export const agentScopeSchema = z.enum(AGENT_SCOPES);
const timestamp = z.iso.datetime({ offset: true });
const id = z.uuid();
export const agentTokenDtoSchema = z.object({ id, label: z.string(), scopes: z.array(agentScopeSchema), createdAt: timestamp, expiresAt: timestamp, revokedAt: timestamp.nullable(), lastUsedAt: timestamp.nullable() });
export const agentConsentDtoSchema = z.object({ id, accountId: id, providerId: z.string(), grantedAt: timestamp, expiresAt: timestamp, revokedAt: timestamp.nullable() });
export const agentObservationDtoSchema = z.object({ id, accountId: id, providerId: z.string(), points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), capturedAt: timestamp, sourceHost: z.string(), sourceMethod: z.enum(["page_capture", "manual_entry"]), status: z.enum(["accepted", "held", "rejected"]), holdReason: z.string().nullable(), createdAt: timestamp, reviewedAt: timestamp.nullable() });
export const mintAgentTokenRequestSchema = z.object({ label: z.string().trim().min(1).max(80), scopes: z.array(agentScopeSchema).min(1).max(7), expiresAt: timestamp }).strict();
export const grantAgentConsentRequestSchema = z.object({ accountId: id, expiresAt: timestamp }).strict();
export const submitAgentObservationRequestSchema = z.object({ observationId: id, accountId: id, providerId: z.string().trim().min(1).max(80), points: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), capturedAt: timestamp, sourceUrl: z.url().max(2048), sourceMethod: z.enum(["page_capture", "manual_entry"]).default("manual_entry") }).strict();
export const reviewAgentObservationRequestSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
export type AgentTokenDto = z.infer<typeof agentTokenDtoSchema>;
export type AgentConsentDto = z.infer<typeof agentConsentDtoSchema>;
export type AgentObservationDto = z.infer<typeof agentObservationDtoSchema>;
export type MintAgentTokenRequest = z.infer<typeof mintAgentTokenRequestSchema>;
export type GrantAgentConsentRequest = z.infer<typeof grantAgentConsentRequestSchema>;
export type SubmitAgentObservationRequest = z.input<typeof submitAgentObservationRequestSchema>;
