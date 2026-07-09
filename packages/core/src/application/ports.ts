import type { LoyaltyAccount } from "../domain/loyalty/loyalty-account";

/**
 * Outbound ports (hexagonal architecture). The application layer owns these
 * interfaces; infrastructure adapters implement them. Ports are intentionally
 * small (interface segregation) so adapters only implement what they need.
 */

/**
 * A credential used to authenticate against a loyalty provider. Held in
 * memory only for the duration of a single operation - never persisted.
 */
export interface ProviderCredential {
  readonly username: string;
  readonly secret: string;
}

/**
 * Resolves a `credentialRef` stored on a loyalty account into a usable
 * credential.
 *
 * Implementations:
 * - Server-side vaults (e.g. 1Password Connect) resolve refs directly.
 * - Device-bound vaults (Apple Keychain, Chrome's password manager) cannot be
 *   read by the server; those surfaces resolve the credential locally and
 *   pass it as a transient credential instead (see SyncLoyaltyAccount).
 */
export interface CredentialVault {
  resolve(credentialRef: string): Promise<ProviderCredential | null>;
}

/** A balance reading returned by a provider integration. */
export interface ProviderBalance {
  readonly points: number;
}

/**
 * Integration point for airline and hotel loyalty programs. One adapter can
 * serve many providers (e.g. an aggregator API) or exactly one (a bespoke
 * airline integration); the composite gateway in the infrastructure layer
 * routes by provider id.
 */
export interface TravelProviderGateway {
  supports(providerId: string): boolean;
  fetchBalance(
    account: LoyaltyAccount,
    credential: ProviderCredential | null,
  ): Promise<ProviderBalance>;
}

/** Clock port so use cases are deterministic under test. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** An email ready to send; rendering happens before this port. */
export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * Email delivery port. Implementations: SES in AWS, SMTP against Mailpit in
 * local development, console logging in tests.
 */
export interface Mailer {
  send(email: OutboundEmail): Promise<void>;
}

/**
 * Looks up user contact details from the identity provider (Clerk in
 * production). Batch jobs use it to resolve a user id to an email address.
 */
export interface UserDirectory {
  /** Returns null when the user has no usable email address. */
  getEmail(userId: string): Promise<string | null>;
}

/** A short chat/notification message ready to deliver to a channel. */
export interface OutboundNotification {
  readonly text: string;
  /**
   * Optional richer body for surfaces that render markdown (Slack mrkdwn,
   * Discord). Adapters that only support plain text fall back to `text`.
   */
  readonly markdown?: string;
}

/**
 * Chat / notification delivery port (Slack, Discord, console). Sits alongside
 * `Mailer` so digests and alerts can fan out to chat surfaces, not just email.
 */
export interface Notifier {
  notify(notification: OutboundNotification): Promise<void>;
}

// ─── AI assistant ──────────────────────────────────────────────────────────

export type AssistantRole = "system" | "user" | "assistant";

export interface AssistantMessage {
  readonly role: AssistantRole;
  readonly content: string;
}

/**
 * Large-language-model chat port. Implementations: OpenAI-compatible HTTP
 * APIs, Anthropic, or a deterministic heuristic fallback for local/dev.
 * Never receives credentials — only portfolio context the use case assembles.
 */
export interface LlmAssistant {
  complete(input: {
    readonly system: string;
    readonly messages: readonly AssistantMessage[];
  }): Promise<string>;
}

// ─── Web scraping ──────────────────────────────────────────────────────────

export interface ScrapedPage {
  readonly url: string;
  readonly title: string;
  readonly markdown: string;
  readonly fetchedAt: Date;
}

/**
 * Firecrawl-style page scrape. Adapters may call Firecrawl Cloud, a self-hosted
 * crawler, or a stub that returns curated markdown for demos.
 */
export interface PageScraper {
  scrape(url: string): Promise<ScrapedPage>;
}
