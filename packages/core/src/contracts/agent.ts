import { z } from "zod";

import type { AccessTokenReadModel } from "../application/agent/access-tokens";
import type { AgentSkillReadModel } from "../application/agent/list-skills";
import type { ConsentReadModel } from "../application/agent/consents";
import type {
  SubmitObservationResult,
} from "../application/agent/submit-observation";
import { ACCESS_TOKEN_SCOPES } from "../domain/agent/access-token";
import {
  OBSERVATION_OUTCOMES,
  type AgentObservation,
} from "../domain/agent/observation";

/**
 * Wire contracts for the agent surface: access tokens, consent, skills, and
 * observation write-back. Same conventions as ./index (strict requests, ISO
 * UTC timestamps).
 */

const isoDateTime = z.iso.datetime();

export const accessTokenScopeSchema = z.enum(ACCESS_TOKEN_SCOPES);

export const accessTokenDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayPrefix: z.string(),
  scopes: z.array(accessTokenScopeSchema),
  createdAt: isoDateTime,
  expiresAt: isoDateTime.nullable(),
  lastUsedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
});

export const createAccessTokenRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    scopes: z.array(accessTokenScopeSchema).min(1),
    /** Lifetime in days (1-365); omit for a non-expiring token. */
    ttlDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export const createdAccessTokenDtoSchema = z.object({
  token: accessTokenDtoSchema,
  /** Shown exactly once. Store it in a secret manager. */
  secret: z.string(),
});

export const consentDtoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  grantedAt: isoDateTime,
  expiresAt: isoDateTime,
  revokedAt: isoDateTime.nullable(),
  active: z.boolean(),
});

export const grantConsentRequestSchema = z
  .object({
    providerId: z.string().min(1),
    /** Consent lifetime in days (1-90, default 30). */
    days: z.number().int().min(1).max(90).optional(),
  })
  .strict();

export const agentSkillDtoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  title: z.string(),
  mode: z.enum(["browser", "computer"]),
  version: z.number().int(),
  allowedHosts: z.array(z.string()),
  startUrl: z.url(),
  steps: z.array(z.string()),
  extraction: z.object({ field: z.literal("points"), hint: z.string() }),
  accountLinked: z.boolean(),
  consentActive: z.boolean(),
});

export const submitObservationRequestSchema = z
  .object({
    skillId: z.string().min(1),
    points: z.number().int().nonnegative(),
    /** Exact https page the value was read from (only the host is stored). */
    sourceUrl: z.url(),
    /** Agent identity for the audit trail, e.g. "claude-code". */
    agent: z.string().min(1).max(64).default("unknown"),
    observedAt: isoDateTime.optional(),
    /** Only used to auto-link a program that is not linked yet. */
    membershipNumber: z.string().min(1).optional(),
    /** Set after the user confirmed a value held as needs_review. */
    confirmed: z.boolean().optional(),
  })
  .strict();

export const observationResultDtoSchema = z.object({
  outcome: z.enum(OBSERVATION_OUTCOMES),
  accountId: z.string(),
  points: z.number().int(),
  previousPoints: z.number().int().nullable(),
  message: z.string(),
});

export const agentObservationDtoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  skillId: z.string(),
  agent: z.string(),
  sourceHost: z.string(),
  points: z.number().int(),
  outcome: z.enum(OBSERVATION_OUTCOMES),
  observedAt: isoDateTime,
  createdAt: isoDateTime,
});

export type AccessTokenDto = z.infer<typeof accessTokenDtoSchema>;
export type CreateAccessTokenRequest = z.infer<
  typeof createAccessTokenRequestSchema
>;
export type CreatedAccessTokenDto = z.infer<typeof createdAccessTokenDtoSchema>;
export type ConsentDto = z.infer<typeof consentDtoSchema>;
export type GrantConsentRequest = z.infer<typeof grantConsentRequestSchema>;
export type AgentSkillDto = z.infer<typeof agentSkillDtoSchema>;
export type SubmitObservationRequest = z.input<
  typeof submitObservationRequestSchema
>;
export type ObservationResultDto = z.infer<typeof observationResultDtoSchema>;
export type AgentObservationDto = z.infer<typeof agentObservationDtoSchema>;

export function toAccessTokenDto(token: AccessTokenReadModel): AccessTokenDto {
  return {
    id: token.id,
    name: token.name,
    displayPrefix: token.displayPrefix,
    scopes: [...token.scopes],
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}

export function toConsentDto(consent: ConsentReadModel): ConsentDto {
  return {
    id: consent.id,
    providerId: consent.providerId,
    grantedAt: consent.grantedAt.toISOString(),
    expiresAt: consent.expiresAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    active: consent.active,
  };
}

export function toAgentSkillDto(skill: AgentSkillReadModel): AgentSkillDto {
  return {
    id: skill.id,
    providerId: skill.providerId,
    title: skill.title,
    mode: skill.mode,
    version: skill.version,
    allowedHosts: [...skill.allowedHosts],
    startUrl: skill.startUrl,
    steps: [...skill.steps],
    extraction: { ...skill.extraction },
    accountLinked: skill.accountLinked,
    consentActive: skill.consentActive,
  };
}

export function toObservationResultDto(
  result: SubmitObservationResult,
): ObservationResultDto {
  return { ...result };
}

export function toAgentObservationDto(
  observation: AgentObservation,
): AgentObservationDto {
  return {
    id: observation.id,
    providerId: observation.providerId,
    skillId: observation.skillId,
    agent: observation.agent,
    sourceHost: observation.sourceHost,
    points: observation.points,
    outcome: observation.outcome,
    observedAt: observation.observedAt.toISOString(),
    createdAt: observation.createdAt.toISOString(),
  };
}
