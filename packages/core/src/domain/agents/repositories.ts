import type { AgentObservation, AgentScope, AgentToken, ObservationConsent, PreparedObservation } from "./models";
export interface AgentTokenRepository {
  insert(token: AgentToken): Promise<void>;
  authenticate(hash: string, now: Date, requiredScope?: AgentScope): Promise<AgentToken | null>;
  findByUserId(userId: string): Promise<AgentToken[]>;
  revoke(userId: string, tokenId: string, now: Date): Promise<boolean>;
}
export interface ObservationConsentRepository {
  grant(consent: ObservationConsent): Promise<void>;
  findByUserId(userId: string): Promise<ObservationConsent[]>;
  findActive(userId: string, accountId: string, now: Date): Promise<ObservationConsent | null>;
  revoke(userId: string, consentId: string, now: Date): Promise<boolean>;
}
export interface AgentObservationRepository {
  /** Must atomically check token/owner/consent and persist audit plus snapshot. */
  ingest(observation: PreparedObservation, now: Date): Promise<AgentObservation>;
  findByUserId(userId: string, status?: "held"): Promise<AgentObservation[]>;
  findByUserAndId(userId: string, observationId: string): Promise<AgentObservation | null>;
  /** Atomically transitions a held row and writes at most one approved snapshot. */
  review(userId: string, observationId: string, decision: "approve" | "reject", now: Date): Promise<AgentObservation>;
}
