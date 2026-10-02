import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DomainError } from "../errors";

import { AGENT_SCOPES, type AgentScope } from "../../contracts/agents";
export { AGENT_SCOPES, type AgentScope } from "../../contracts/agents";
export class AgentError extends DomainError {
  constructor(readonly code: string, message: string) { super(message); }
}
export const invalidAgentInput = (message: string) => new AgentError("AGENT_VALIDATION_ERROR", message);
export const tokenDenied = () => new AgentError("AGENT_TOKEN_INVALID", "Agent token is invalid, revoked, or expired");
export const consentDenied = () => new AgentError("OBSERVATION_CONSENT_REQUIRED", "An active capture consent is required for this account");
export const agentNotFound = () => new AgentError("AGENT_RECORD_NOT_FOUND", "Agent record was not found");
export const observationConflict = () => new AgentError("OBSERVATION_CONFLICT", "Observation ID already has a different payload or decision");
export const MAX_TOKEN_LIFETIME_MS = 90 * 86400_000;
export const MAX_CONSENT_LIFETIME_MS = 30 * 86400_000;
export interface AgentTokenMetadata {
  readonly id: string; readonly label: string; readonly scopes: readonly AgentScope[];
  readonly createdAt: Date; readonly expiresAt: Date; readonly revokedAt: Date | null; readonly lastUsedAt: Date | null;
}
export interface AgentToken extends AgentTokenMetadata { readonly userId: string; readonly tokenHash: string; }
export interface AgentIdentity { readonly userId: string; readonly tokenId: string; readonly scopes: readonly AgentScope[]; }
export function tokenMetadata({ id, label, scopes, createdAt, expiresAt, revokedAt, lastUsedAt }: AgentToken): AgentTokenMetadata {
  return { id, label, scopes, createdAt, expiresAt, revokedAt, lastUsedAt };
}
export function validateExpiry(expiresAt: Date, now: Date, max: number) {
  const lifetime = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > max) throw invalidAgentInput("Expiry must be in the future and within the permitted lifetime");
}
export function hashAgentToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function createAgentToken(input: { userId: string; label: string; scopes: readonly AgentScope[]; expiresAt: Date }, now: Date) {
  const label = input.label.trim();
  if (!label || label.length > 80 || !input.userId) throw invalidAgentInput("Token label must be between 1 and 80 characters");
  const scopes = [...new Set(input.scopes)];
  if (!scopes.length || scopes.some((scope) => !AGENT_SCOPES.includes(scope))) throw invalidAgentInput("At least one supported token scope is required");
  validateExpiry(input.expiresAt, now, MAX_TOKEN_LIFETIME_MS);
  const token = `pu_${randomBytes(32).toString("base64url")}`;
  const record: AgentToken = { id: randomUUID(), userId: input.userId, label, scopes, tokenHash: hashAgentToken(token), createdAt: now, expiresAt: input.expiresAt, revokedAt: null, lastUsedAt: null };
  return { token, record };
}
export function validateAgentToken(record: AgentToken | null, now: Date, requiredScope?: AgentScope): asserts record is AgentToken {
  if (!record || record.revokedAt || record.expiresAt.getTime() <= now.getTime()) throw tokenDenied();
  if (requiredScope && !record.scopes.includes(requiredScope)) throw new AgentError("AGENT_SCOPE_DENIED", "Agent token does not permit this operation");
}
export interface ObservationConsent {
  readonly id: string; readonly userId: string; readonly accountId: string; readonly providerId: string;
  readonly grantedAt: Date; readonly expiresAt: Date; readonly revokedAt: Date | null;
}
export type ObservationSourceMethod = "page_capture" | "manual_entry";
export interface SubmitObservationInput {
  readonly userId: string; readonly tokenId: string; readonly observationId: string; readonly accountId: string;
  readonly providerId: string; readonly points: number; readonly capturedAt: Date; readonly sourceUrl: string;
  readonly sourceMethod?: ObservationSourceMethod;
}
export interface PreparedObservation {
  readonly id: string; readonly userId: string; readonly tokenId: string; readonly accountId: string; readonly providerId: string;
  readonly points: number; readonly capturedAt: Date; readonly sourceHost: string; readonly sourceMethod: ObservationSourceMethod; readonly payloadHash: string;
}
export type ObservationStatus = "accepted" | "held" | "rejected";
export interface AgentObservation extends PreparedObservation {
  readonly consentId: string; readonly status: ObservationStatus; readonly holdReason: string | null;
  readonly createdAt: Date; readonly reviewedAt: Date | null; readonly snapshotId: string | null;
}
export type AgentObservationMetadata = Omit<AgentObservation, "userId" | "tokenId" | "payloadHash" | "consentId" | "snapshotId">;
export function observationMetadata({ id, accountId, providerId, points, capturedAt, sourceHost, sourceMethod, status, holdReason, createdAt, reviewedAt }: AgentObservation): AgentObservationMetadata {
  return { id, accountId, providerId, points, capturedAt, sourceHost, sourceMethod, status, holdReason, createdAt, reviewedAt };
}
export const OBSERVATION_PROVIDER_HOSTS: Readonly<Record<string, readonly string[]>> = {
  united: ["united.com", "www.united.com"], delta: ["delta.com", "www.delta.com"], american: ["aa.com", "www.aa.com"],
  marriott: ["marriott.com", "www.marriott.com"], hilton: ["hilton.com", "www.hilton.com"], hyatt: ["hyatt.com", "www.hyatt.com", "world.hyatt.com"],
  "chase-ultimate-rewards": ["chase.com", "www.chase.com"], "amex-membership-rewards": ["americanexpress.com", "www.americanexpress.com", "global.americanexpress.com"],
  "capital-one-miles": ["capitalone.com", "www.capitalone.com", "verified.capitalone.com"], "citi-thankyou": ["thankyou.com", "www.thankyou.com"],
  bilt: ["bilt.com", "www.bilt.com", "biltrewards.com", "www.biltrewards.com"], amtrak: ["amtrak.com", "www.amtrak.com"], rakuten: ["rakuten.com", "www.rakuten.com"],
};
export function prepareObservation(input: SubmitObservationInput, now: Date): PreparedObservation {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.observationId)) throw invalidAgentInput("Observation ID must be a UUID");
  if (!Number.isSafeInteger(input.points) || input.points < 0) throw invalidAgentInput("Points must be a non-negative safe integer");
  const captureTime = input.capturedAt.getTime();
  if (!Number.isFinite(captureTime) || captureTime > now.getTime() || captureTime < now.getTime() - 30 * 86400_000) throw invalidAgentInput("Capture time must be valid, not future, and within 30 days");
  let url: URL;
  try { url = new URL(input.sourceUrl); } catch { throw invalidAgentInput("A valid provider source URL is required"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !OBSERVATION_PROVIDER_HOSTS[input.providerId]?.includes(url.hostname)) throw invalidAgentInput("Source URL does not match an exact permitted provider host");
  const sourceMethod = input.sourceMethod ?? "manual_entry";
  if (!["page_capture", "manual_entry"].includes(sourceMethod) || !input.userId || !input.tokenId || !input.accountId) throw invalidAgentInput("Observation identity and capture method are required");
  const payloadHash = createHash("sha256").update(JSON.stringify([input.userId, input.tokenId, input.accountId, input.providerId, input.points, input.capturedAt.toISOString(), url.href, sourceMethod])).digest("hex");
  return { id: input.observationId.toLowerCase(), userId: input.userId, tokenId: input.tokenId, accountId: input.accountId, providerId: input.providerId, points: input.points, capturedAt: input.capturedAt, sourceHost: url.hostname, sourceMethod, payloadHash };
}
export function observationHoldReason(previous: number | null, next: number): string | null {
  if (previous === null || previous === next) return null;
  if (previous === 0 || next === 0 || Math.max(previous, next) / Math.min(previous, next) >= 10) return "Balance changed by at least 10× (including a zero boundary); review is required";
  return null;
}
