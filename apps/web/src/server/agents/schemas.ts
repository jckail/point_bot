import { z } from "zod";
import { mintAgentTokenRequestSchema, grantAgentConsentRequestSchema, submitAgentObservationRequestSchema, reviewAgentObservationRequestSchema } from "@pointup/core/agent-contracts";

export const mintTokenSchema = mintAgentTokenRequestSchema.transform((body) => ({ ...body, expiresAt: new Date(body.expiresAt) }));
export const grantConsentSchema = grantAgentConsentRequestSchema.transform((body) => ({ ...body, expiresAt: new Date(body.expiresAt) }));
export const observationSchema = submitAgentObservationRequestSchema.transform((body) => ({ ...body, capturedAt: new Date(body.capturedAt) }));
export const reviewObservationSchema = reviewAgentObservationRequestSchema;
export const agentRecordIdSchema = z.uuid();
