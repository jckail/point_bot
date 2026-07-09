/**
 * Base class for all domain errors. Carries a stable machine-readable `code`
 * so every surface (web, mobile, extension) can map errors to UX without
 * parsing messages.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProviderNotSupportedError extends DomainError {
  readonly code = "PROVIDER_NOT_SUPPORTED";

  constructor(providerId: string) {
    super(`Provider "${providerId}" is not supported`);
  }
}

export class DuplicateLoyaltyAccountError extends DomainError {
  readonly code = "DUPLICATE_LOYALTY_ACCOUNT";

  constructor(providerId: string) {
    super(`A loyalty account for provider "${providerId}" is already linked`);
  }
}

export class LoyaltyAccountNotFoundError extends DomainError {
  readonly code = "LOYALTY_ACCOUNT_NOT_FOUND";

  constructor(accountId: string) {
    super(`Loyalty account "${accountId}" was not found`);
  }
}

export class InvalidMembershipNumberError extends DomainError {
  readonly code = "INVALID_MEMBERSHIP_NUMBER";

  constructor() {
    super("Membership number must not be empty");
  }
}

export class InvalidValuationError extends DomainError {
  readonly code = "INVALID_VALUATION";

  constructor() {
    super("Cents-per-point must be a number greater than 0 and at most 100");
  }
}

export class CredentialUnavailableError extends DomainError {
  readonly code = "CREDENTIAL_UNAVAILABLE";

  constructor(reason: string) {
    super(`Credential could not be resolved: ${reason}`);
  }
}

export class InvalidBalanceError extends DomainError {
  readonly code = "INVALID_BALANCE";

  constructor() {
    super("Points balance must be a non-negative integer");
  }
}

export class InvalidCaptureTimeError extends DomainError {
  readonly code = "INVALID_CAPTURE_TIME";

  constructor(reason: string) {
    super(`Invalid capture time: ${reason}`);
  }
}

export class TripGoalNotFoundError extends DomainError {
  readonly code = "TRIP_GOAL_NOT_FOUND";

  constructor(goalId: string) {
    super(`Trip goal "${goalId}" was not found`);
  }
}

export class AwardWatchNotFoundError extends DomainError {
  readonly code = "AWARD_WATCH_NOT_FOUND";

  constructor(watchId: string) {
    super(`Award watch "${watchId}" was not found`);
  }
}

export class InvalidAwardWatchError extends DomainError {
  readonly code = "INVALID_AWARD_WATCH";

  constructor(message: string) {
    super(message);
  }
}

export class InvalidGoalTitleError extends DomainError {
  readonly code = "INVALID_GOAL_TITLE";

  constructor(message = "Goal title must be between 1 and 120 characters") {
    super(message);
  }
}

export class InvalidGoalTargetError extends DomainError {
  readonly code = "INVALID_GOAL_TARGET";

  constructor() {
    super("Target points must be a positive whole number");
  }
}

export class InvalidImportError extends DomainError {
  readonly code = "INVALID_IMPORT";

  constructor(reason: string) {
    super(`Import failed: ${reason}`);
  }
}

export class InvalidAccountNotesError extends DomainError {
  readonly code = "INVALID_ACCOUNT_NOTES";

  constructor() {
    super("Account notes must be at most 2000 characters");
  }
}

export class InvalidAccountTagError extends DomainError {
  readonly code = "INVALID_ACCOUNT_TAG";

  constructor(tag: string) {
    super(`Invalid account tag: "${tag}"`);
  }
}

export class AccountNotRestorableError extends DomainError {
  readonly code = "ACCOUNT_NOT_RESTORABLE";

  constructor(reason: string) {
    super(`Account cannot be restored: ${reason}`);
  }
}

export class DemoPortfolioNotEmptyError extends DomainError {
  readonly code = "DEMO_PORTFOLIO_NOT_EMPTY";

  constructor() {
    super("Demo portfolio can only be seeded into an empty account");
  }
}

export class ShareLinkNotFoundError extends DomainError {
  readonly code = "SHARE_LINK_NOT_FOUND";

  constructor() {
    super("Share link was not found or has expired");
  }
}

export class AssistantUnavailableError extends DomainError {
  readonly code = "ASSISTANT_UNAVAILABLE";

  constructor(reason: string) {
    super(`Assistant unavailable: ${reason}`);
  }
}

export class ScrapeFailedError extends DomainError {
  readonly code = "SCRAPE_FAILED";

  constructor(reason: string) {
    super(`Page scrape failed: ${reason}`);
  }
}

export class InvalidAssistantMessageError extends DomainError {
  readonly code = "INVALID_ASSISTANT_MESSAGE";

  constructor() {
    super("Assistant message must be between 1 and 4000 characters");
  }
}

export class InvalidScrapeUrlError extends DomainError {
  readonly code = "INVALID_SCRAPE_URL";

  constructor() {
    super("Scrape URL must be an absolute http(s) URL");
  }
}
