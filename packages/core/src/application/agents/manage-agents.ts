import { randomUUID } from "node:crypto";
import { requireOwnedAccount } from "../loyalty/access";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { AgentObservationRepository, AgentTokenRepository, ObservationConsentRepository } from "../../domain/agents/repositories";
import { agentNotFound, consentDenied, createAgentToken, hashAgentToken, invalidAgentInput, MAX_CONSENT_LIFETIME_MS, observationMetadata, prepareObservation, tokenDenied, tokenMetadata, validateExpiry, type AgentIdentity, type AgentScope, type ObservationConsent, type SubmitObservationInput } from "../../domain/agents/models";
function consentMetadata({ id, accountId, providerId, grantedAt, expiresAt, revokedAt }: ObservationConsent) {
  return { id, accountId, providerId, grantedAt, expiresAt, revokedAt };
}
export class MintAgentToken {
  constructor(private readonly tokens: AgentTokenRepository, private readonly clock: Clock = systemClock) {}
  async execute(input: { userId: string; label: string; scopes: readonly AgentScope[]; expiresAt: Date }) {
    const { token, record } = createAgentToken(input, this.clock.now());
    await this.tokens.insert(record);
    return { token, metadata: tokenMetadata(record) };
  }
}
export class AuthenticateAgentToken {
  constructor(private readonly tokens: AgentTokenRepository, private readonly clock: Clock = systemClock) {}
  async execute(token: string, requiredScope?: AgentScope): Promise<AgentIdentity> {
    if (!/^pu_[A-Za-z0-9_-]{43}$/.test(token)) throw tokenDenied();
    const record = await this.tokens.authenticate(hashAgentToken(token), this.clock.now(), requiredScope);
    if (!record) throw tokenDenied();
    return { userId: record.userId, tokenId: record.id, scopes: record.scopes };
  }
}
export class ListAgentTokens {
  constructor(private readonly tokens: AgentTokenRepository) {}
  async execute(userId: string) { return (await this.tokens.findByUserId(userId)).map(tokenMetadata); }
}
export class RevokeAgentToken {
  constructor(private readonly tokens: AgentTokenRepository, private readonly clock: Clock = systemClock) {}
  async execute(input: { userId: string; tokenId: string }) {
    if (!await this.tokens.revoke(input.userId, input.tokenId, this.clock.now())) throw agentNotFound();
  }
}
export class GrantObservationConsent {
  constructor(private readonly consents: ObservationConsentRepository, private readonly accounts: LoyaltyAccountRepository, private readonly clock: Clock = systemClock) {}
  async execute(input: { userId: string; accountId: string; expiresAt: Date }) {
    const now = this.clock.now();
    validateExpiry(input.expiresAt, now, MAX_CONSENT_LIFETIME_MS);
    const account = await requireOwnedAccount(this.accounts, input.userId, input.accountId);
    const consent = { id: randomUUID(), userId: input.userId, accountId: account.id, providerId: account.providerId, grantedAt: now, expiresAt: input.expiresAt, revokedAt: null };
    await this.consents.grant(consent);
    return consentMetadata(consent);
  }
}
export class ListObservationConsents {
  constructor(private readonly consents: ObservationConsentRepository) {}
  async execute(userId: string) { return (await this.consents.findByUserId(userId)).map(consentMetadata); }
}
export class RevokeObservationConsent {
  constructor(private readonly consents: ObservationConsentRepository, private readonly clock: Clock = systemClock) {}
  async execute(input: { userId: string; consentId: string }) {
    if (!await this.consents.revoke(input.userId, input.consentId, this.clock.now())) throw agentNotFound();
  }
}
export class SubmitAgentObservation {
  constructor(private readonly observations: AgentObservationRepository, private readonly accounts: LoyaltyAccountRepository, private readonly consents: ObservationConsentRepository, private readonly clock: Clock = systemClock) {}
  async execute(input: SubmitObservationInput) {
    const now = this.clock.now();
    const observation = prepareObservation(input, now);
    const account = await requireOwnedAccount(this.accounts, input.userId, input.accountId);
    if (account.providerId !== input.providerId) throw invalidAgentInput("Observation provider does not match the owned account");
    if (!await this.consents.findActive(input.userId, account.id, now)) throw consentDenied();
    // The atomic repository owns the authoritative baseline and anomaly check.
    return observationMetadata(await this.observations.ingest(observation, now));
  }
}
export class ListAgentObservations {
  constructor(private readonly observations: AgentObservationRepository) {}
  async execute(userId: string, status?: "held") { return (await this.observations.findByUserId(userId, status)).map(observationMetadata); }
}
export class ReviewAgentObservation {
  constructor(private readonly observations: AgentObservationRepository, private readonly accounts: LoyaltyAccountRepository, private readonly clock: Clock = systemClock) {}
  async execute(input: { userId: string; observationId: string; decision: "approve" | "reject" }) {
    if (!["approve", "reject"].includes(input.decision)) throw invalidAgentInput("Review decision must be approve or reject");
    const observation = await this.observations.findByUserAndId(input.userId, input.observationId);
    if (!observation) throw agentNotFound();
    await requireOwnedAccount(this.accounts, input.userId, observation.accountId);
    return observationMetadata(await this.observations.review(input.userId, input.observationId, input.decision, this.clock.now()));
  }
}
