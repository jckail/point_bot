import { DrizzleLoyaltyAccountRepository } from "@pointup/core";
import {
  AuthenticateAgentToken, DrizzleAgentObservationRepository, DrizzleAgentTokenRepository,
  DrizzleObservationConsentRepository, GrantObservationConsent, ListAgentObservations,
  ListAgentTokens, ListObservationConsents, MintAgentToken, RevokeAgentToken,
  RevokeObservationConsent, ReviewAgentObservation, SubmitAgentObservation,
} from "@pointup/core/agents";
import { getContainer } from "../container";

function buildAgentServices() {
  const { db } = getContainer();
  const tokens = new DrizzleAgentTokenRepository(db);
  const consents = new DrizzleObservationConsentRepository(db);
  const observations = new DrizzleAgentObservationRepository(db);
  const accounts = new DrizzleLoyaltyAccountRepository(db);
  return {
    authenticate: new AuthenticateAgentToken(tokens),
    mintToken: new MintAgentToken(tokens),
    listTokens: new ListAgentTokens(tokens),
    revokeToken: new RevokeAgentToken(tokens),
    grantConsent: new GrantObservationConsent(consents, accounts),
    listConsents: new ListObservationConsents(consents),
    revokeConsent: new RevokeObservationConsent(consents),
    submitObservation: new SubmitAgentObservation(observations, accounts, consents),
    listObservations: new ListAgentObservations(observations),
    reviewObservation: new ReviewAgentObservation(observations, accounts),
  };
}
let services: ReturnType<typeof buildAgentServices> | undefined;
export function getAgentServices() { return services ??= buildAgentServices(); }
