import type { ErrorCode } from "@pointup/core";

/**
 * Result shape returned by form server actions consumed via `useActionState`.
 * Domain error codes are translated to user-facing copy here, in one place.
 */

export type ActionResult =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export const idleActionResult: ActionResult = { status: "idle" };

const DOMAIN_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  PROVIDER_NOT_SUPPORTED: "That program isn't supported yet.",
  DUPLICATE_LOYALTY_ACCOUNT: "You've already linked this program.",
  LOYALTY_ACCOUNT_NOT_FOUND: "We couldn't find that account.",
  INVALID_MEMBERSHIP_NUMBER: "Membership number can't be empty.",
  INVALID_BALANCE: "Balance must be a whole, non-negative number.",
  INVALID_CAPTURE_TIME: "The date can't be in the future.",
  INVALID_GOAL_TITLE: "Goal title must be between 1 and 120 characters.",
  INVALID_GOAL_TARGET: "Target points must be a positive whole number.",
  TRIP_GOAL_NOT_FOUND: "We couldn't find that goal.",
  INVALID_IMPORT: "That CSV couldn't be imported. Check the export format.",
  INVALID_ACCOUNT_NOTES: "Notes must be at most 2000 characters.",
  INVALID_ACCOUNT_TAG:
    "Tags must be short lowercase words (letters, numbers, hyphens).",
  DEMO_PORTFOLIO_NOT_EMPTY:
    "Sample data can only be added when you have no linked programs yet.",
  ACCOUNT_NOT_RESTORABLE:
    "That program can't be restored — the undo window may have expired.",
  SHARE_LINK_NOT_FOUND: "That share link wasn't found.",
  INVALID_ACCESS_TOKEN_REQUEST:
    "Give the token a name, at least one scope, and a lifetime of 1-365 days.",
  ACCESS_TOKEN_NOT_FOUND: "We couldn't find that token.",
  INVALID_CONSENT: "Consent can last between 1 and 90 days.",
  CONSENT_NOT_FOUND: "We couldn't find that consent.",
  REVIEW_NOT_FOUND: "We couldn't find that pending reading.",
  REVIEW_ALREADY_RESOLVED: "That reading was already confirmed or rejected.",
  REVIEW_EXPIRED:
    "That reading expired (24 hours). Ask the agent to read the balance again.",
  REVIEW_STALE:
    "Your balance changed since this reading was held. Reject it and ask the agent to read it again.",
  CREDENTIAL_UNAVAILABLE:
    "No credentials available for this program - connect a vault or enter the balance manually.",
};

export function messageForDomainError(code: ErrorCode): string {
  return DOMAIN_ERROR_MESSAGES[code] ?? "Something went wrong. Please try again.";
}
