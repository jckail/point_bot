/**
 * Base class for all domain errors. Carries a stable machine-readable `code`
 * so every surface (web, mobile, extension) can map errors to UX without
 * parsing messages.
 */
export abstract class DomainError extends Error {
  /** Stable machine-readable code; subclasses narrow it to a string literal. */
  abstract readonly code: DomainErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** An identifier failed its edge parse (empty or not a string). */
export class InvalidIdError extends DomainError {
  readonly code = "INVALID_ID" as const;

  constructor(kind: string) {
    super(`${kind} must be a non-empty string`);
  }
}

export class ProviderNotSupportedError extends DomainError {
  readonly code = "PROVIDER_NOT_SUPPORTED" as const;

  constructor(providerId: string) {
    super(`Provider "${providerId}" is not supported`);
  }
}

export class DuplicateLoyaltyAccountError extends DomainError {
  readonly code = "DUPLICATE_LOYALTY_ACCOUNT" as const;

  constructor(providerId: string) {
    super(`A loyalty account for provider "${providerId}" is already linked`);
  }
}

export class LoyaltyAccountNotFoundError extends DomainError {
  readonly code = "LOYALTY_ACCOUNT_NOT_FOUND" as const;

  /**
   * Normally an account id; flows that have no account yet (an agent
   * write-back for an unlinked program) pass the provider id, so this stays a
   * plain string rather than a `LoyaltyAccountId`.
   */
  constructor(accountId: string) {
    super(`Loyalty account "${accountId}" was not found`);
  }
}

/** An explicit transfer card is unknown or incompatible with its program. */
export class InvalidCardProductError extends DomainError {
  readonly code = "INVALID_CARD_PRODUCT" as const;
  constructor() { super("Choose a supported transfer card for this program, or Unknown."); }
}

export class InvalidMembershipNumberError extends DomainError {
  readonly code = "INVALID_MEMBERSHIP_NUMBER" as const;

  constructor() {
    super("Membership number must not be empty");
  }
}

export class InvalidValuationError extends DomainError {
  readonly code = "INVALID_VALUATION" as const;

  constructor() {
    super("Cents-per-point must be a number greater than 0 and at most 100");
  }
}

export class InvalidDisplayCurrencyError extends DomainError {
  readonly code = "INVALID_DISPLAY_CURRENCY" as const;

  constructor(currency: string) {
    super(`Display currency "${currency}" is not supported`);
  }
}

export class CredentialUnavailableError extends DomainError {
  readonly code = "CREDENTIAL_UNAVAILABLE" as const;

  constructor(reason: string) {
    super(`Credential could not be resolved: ${reason}`);
  }
}

export class InvalidBalanceError extends DomainError {
  readonly code = "INVALID_BALANCE" as const;

  constructor() {
    super("Points balance must be a non-negative integer");
  }
}

export class InvalidCaptureTimeError extends DomainError {
  readonly code = "INVALID_CAPTURE_TIME" as const;

  constructor(reason: string) {
    super(`Invalid capture time: ${reason}`);
  }
}

export class TripGoalNotFoundError extends DomainError {
  readonly code = "TRIP_GOAL_NOT_FOUND" as const;

  constructor(goalId: string) {
    super(`Trip goal "${goalId}" was not found`);
  }
}

export class AwardWatchNotFoundError extends DomainError {
  readonly code = "AWARD_WATCH_NOT_FOUND" as const;

  constructor(watchId: string) {
    super(`Award watch "${watchId}" was not found`);
  }
}

export class InvalidAwardWatchError extends DomainError {
  readonly code = "INVALID_AWARD_WATCH" as const;

  constructor(message: string) {
    super(message);
  }
}

export class InvalidTransferBonusError extends DomainError {
  readonly code = "INVALID_TRANSFER_BONUS" as const;

  constructor(message: string) {
    super(message);
  }
}

export class InvalidRedemptionGoalError extends DomainError {
  readonly code = "INVALID_REDEMPTION_GOAL" as const;

  constructor(message: string) {
    super(message);
  }
}

export class InvalidGoalTitleError extends DomainError {
  readonly code = "INVALID_GOAL_TITLE" as const;

  constructor(message = "Goal title must be between 1 and 120 characters") {
    super(message);
  }
}

export class InvalidGoalTargetError extends DomainError {
  readonly code = "INVALID_GOAL_TARGET" as const;

  constructor() {
    super("Target points must be a positive whole number");
  }
}

export class InvalidImportError extends DomainError {
  readonly code = "INVALID_IMPORT" as const;

  constructor(reason: string) {
    super(`Import failed: ${reason}`);
  }
}

export class InvalidAccountNotesError extends DomainError {
  readonly code = "INVALID_ACCOUNT_NOTES" as const;

  constructor() {
    super("Account notes must be at most 2000 characters");
  }
}

export class InvalidAccountTagError extends DomainError {
  readonly code = "INVALID_ACCOUNT_TAG" as const;

  constructor(tag: string) {
    super(`Invalid account tag: "${tag}"`);
  }
}

export class AccountNotRestorableError extends DomainError {
  readonly code = "ACCOUNT_NOT_RESTORABLE" as const;

  constructor(reason: string) {
    super(`Account cannot be restored: ${reason}`);
  }
}

export class DemoPortfolioNotEmptyError extends DomainError {
  readonly code = "DEMO_PORTFOLIO_NOT_EMPTY" as const;

  constructor() {
    super("Demo portfolio can only be seeded into an empty account");
  }
}

export class InvalidShareExpiryError extends DomainError {
  readonly code = "INVALID_SHARE_EXPIRY" as const;

  constructor() {
    super("Share expiry must be a whole number of days between 1 and 365, or no expiry");
  }
}

export class ShareLinkNotFoundError extends DomainError {
  readonly code = "SHARE_LINK_NOT_FOUND" as const;

  constructor() {
    super("Share link was not found or has expired");
  }
}

export class AssistantUnavailableError extends DomainError {
  readonly code = "ASSISTANT_UNAVAILABLE" as const;

  constructor(reason: string) {
    super(`Assistant unavailable: ${reason}`);
  }
}

export class ScrapeFailedError extends DomainError {
  readonly code = "SCRAPE_FAILED" as const;

  constructor(reason: string) {
    super(`Page scrape failed: ${reason}`);
  }
}

export class InvalidAssistantMessageError extends DomainError {
  readonly code = "INVALID_ASSISTANT_MESSAGE" as const;

  constructor() {
    super("Assistant message must be between 1 and 4000 characters");
  }
}

export class InvalidScrapeUrlError extends DomainError {
  readonly code = "INVALID_SCRAPE_URL" as const;

  constructor() {
    super("Scrape URL must be an absolute http(s) URL");
  }
}

// ─── Agent bounded context ─────────────────────────────────────────────────

export class AccessTokenInvalidError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;

  constructor() {
    super("Access token is invalid, expired, or revoked");
  }
}

export class InsufficientScopeError extends DomainError {
  readonly code = "INSUFFICIENT_SCOPE" as const;

  constructor(scope: string) {
    super(`This credential lacks the "${scope}" scope`);
  }
}

export class InvalidAccessTokenRequestError extends DomainError {
  readonly code = "INVALID_ACCESS_TOKEN_REQUEST" as const;

  constructor(message: string) {
    super(message);
  }
}

export class AccessTokenNotFoundError extends DomainError {
  readonly code = "ACCESS_TOKEN_NOT_FOUND" as const;

  constructor(tokenId: string) {
    super(`Access token "${tokenId}" was not found`);
  }
}

export class ConsentRequiredError extends DomainError {
  readonly code = "CONSENT_REQUIRED" as const;

  constructor(providerId: string) {
    super(
      `No active consent for "${providerId}". Ask the user to grant agent access for this program first.`,
    );
  }
}

export class ConsentNotFoundError extends DomainError {
  readonly code = "CONSENT_NOT_FOUND" as const;

  constructor(consentId: string) {
    super(`Consent "${consentId}" was not found`);
  }
}

export class InvalidConsentError extends DomainError {
  readonly code = "INVALID_CONSENT" as const;

  constructor(message: string) {
    super(message);
  }
}

export class SkillNotFoundError extends DomainError {
  readonly code = "SKILL_NOT_FOUND" as const;

  constructor(skillId: string) {
    super(`Agent skill "${skillId}" was not found`);
  }
}

export class InvalidObservationError extends DomainError {
  readonly code = "INVALID_OBSERVATION" as const;

  constructor(message: string) {
    super(`Observation rejected: ${message}`);
  }
}

export class ObservationReplayConflictError extends DomainError {
  readonly code = "OBSERVATION_REPLAY_CONFLICT" as const;
  constructor() {
    super("Capture ID already belongs to a different observation payload");
  }
}

export class ObservationReviewNotFoundError extends DomainError {
  readonly code = "REVIEW_NOT_FOUND" as const;

  constructor(reviewId: string) {
    super(`Pending review "${reviewId}" was not found`);
  }
}

/** The review was already confirmed/rejected (reviews are single-use). */
export class ObservationReviewResolvedError extends DomainError {
  readonly code = "REVIEW_ALREADY_RESOLVED" as const;

  constructor(reviewId: string) {
    super(`Review "${reviewId}" was already resolved`);
  }
}

export class ObservationReviewExpiredError extends DomainError {
  readonly code = "REVIEW_EXPIRED" as const;

  constructor(reviewId: string) {
    super(`Review "${reviewId}" expired; ask the agent to read the balance again`);
  }
}

/** The account or its latest balance changed since the value was held. */
export class ObservationReviewStaleError extends DomainError {
  readonly code = "REVIEW_STALE" as const;

  constructor(reviewId: string) {
    super(
      `Review "${reviewId}" no longer matches the account's latest balance; reject it and ask the agent to read the balance again`,
    );
  }
}

/** A cookie-authenticated state-changing request failed the CSRF checks. */
export class CsrfRejectedError extends DomainError {
  readonly code = "CSRF_REJECTED" as const;

  constructor(reason: string) {
    super(`Request rejected: ${reason}`);
  }
}

/**
 * Every concrete DomainError subclass. `ErrorCode` is derived from their
 * literal `code`s, so a new error class that is not listed here is caught by
 * test/error-codes.test.ts and one that is listed but has no HTTP status fails
 * to compile (`HTTP_STATUS_BY_ERROR_CODE satisfies Record<ErrorCode, number>`).
 */
export class AssistantActionNotFoundError extends DomainError {
  readonly code = "ASSISTANT_ACTION_NOT_FOUND" as const;
  constructor() { super("Assistant action was not found."); }
}

export class InvalidAssistantActionError extends DomainError {
  readonly code = "INVALID_ASSISTANT_ACTION" as const;
  constructor(message = "Assistant action proposal is invalid.") { super(message); }
}

export const DOMAIN_ERROR_CLASSES = [
  AssistantActionNotFoundError,
  InvalidAssistantActionError,
  InvalidIdError,
  ProviderNotSupportedError,
  DuplicateLoyaltyAccountError,
  LoyaltyAccountNotFoundError,
  InvalidMembershipNumberError,
  InvalidCardProductError,
  InvalidValuationError,
  InvalidDisplayCurrencyError,
  CredentialUnavailableError,
  InvalidBalanceError,
  InvalidCaptureTimeError,
  TripGoalNotFoundError,
  AwardWatchNotFoundError,
  InvalidAwardWatchError,
  InvalidTransferBonusError,
  InvalidRedemptionGoalError,
  InvalidGoalTitleError,
  InvalidGoalTargetError,
  InvalidImportError,
  InvalidAccountNotesError,
  InvalidAccountTagError,
  AccountNotRestorableError,
  DemoPortfolioNotEmptyError,
  InvalidShareExpiryError,
  ShareLinkNotFoundError,
  AssistantUnavailableError,
  ScrapeFailedError,
  InvalidAssistantMessageError,
  InvalidScrapeUrlError,
  AccessTokenInvalidError,
  InsufficientScopeError,
  InvalidAccessTokenRequestError,
  AccessTokenNotFoundError,
  ConsentRequiredError,
  ConsentNotFoundError,
  InvalidConsentError,
  SkillNotFoundError,
  InvalidObservationError,
  ObservationReplayConflictError,
  ObservationReviewNotFoundError,
  ObservationReviewResolvedError,
  ObservationReviewExpiredError,
  ObservationReviewStaleError,
  CsrfRejectedError,
] as const;

/** Codes carried by domain errors (the literal `code` of each subclass). */
export type DomainErrorCode = InstanceType<
  (typeof DOMAIN_ERROR_CLASSES)[number]
>["code"];

/**
 * Codes emitted by the delivery layer rather than a domain error: request
 * validation, unexpected failures and rate limiting.
 */
export const TRANSPORT_ERROR_CODES = [
  "REQUEST_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INVALID_REQUEST",
  "INTERNAL",
  "RATE_LIMITED",
] as const;
export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];

/** Every error code that can appear in an API error envelope. */
export type ErrorCode = DomainErrorCode | TransportErrorCode;
