import {
  IssueAccessToken,
  ListAccessTokens,
  RevokeAccessToken,
  AuthenticateAccessToken,
} from "../application/agent/access-tokens";
import {
  GrantConsent,
  ListConsents,
  RevokeConsent,
} from "../application/agent/consents";
import { ListAgentSkills } from "../application/agent/list-skills";
import {
  SubmitObservation,
  ResolveObservationReview,
  ListAgentObservations,
} from "../application/agent/submit-observation";
import type { LinkLoyaltyAccount } from "../application/loyalty/link-loyalty-account";
import type { RecordManualBalance } from "../application/loyalty/record-manual-balance";
import type { Repositories } from "./repositories";

/** The agent context reuses two loyalty use cases for write-back. */
export interface AgentModuleDeps {
  repos: Repositories;
  recordManualBalance: RecordManualBalance;
  linkLoyaltyAccount: LinkLoyaltyAccount;
}

/** Composes the agent bounded context (tokens, consent, observations). */
export function buildAgentModule(deps: AgentModuleDeps) {
  const { repos } = deps;
  return {
    issueAccessToken: new IssueAccessToken(repos.accessTokens),
    listAccessTokens: new ListAccessTokens(repos.accessTokens),
    revokeAccessToken: new RevokeAccessToken(repos.accessTokens),
    authenticateAccessToken: new AuthenticateAccessToken(repos.accessTokens),
    grantConsent: new GrantConsent(repos.consents),
    listConsents: new ListConsents(repos.consents),
    revokeConsent: new RevokeConsent(repos.consents),
    listAgentSkills: new ListAgentSkills(repos.loyaltyAccounts, repos.consents),
    submitObservation: new SubmitObservation(
      repos.loyaltyAccounts,
      repos.balanceSnapshots,
      repos.consents,
      repos.observations,
      deps.recordManualBalance,
      deps.linkLoyaltyAccount,
    ),
    resolveObservationReview: new ResolveObservationReview(
      repos.loyaltyAccounts,
      repos.balanceSnapshots,
      repos.observations,
      deps.recordManualBalance,
    ),
    listAgentObservations: new ListAgentObservations(repos.observations),
  };
}

export type AgentModule = ReturnType<typeof buildAgentModule>;
