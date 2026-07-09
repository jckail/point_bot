/**
 * Result shape returned by form server actions consumed via `useActionState`.
 * Domain error codes are translated to user-facing copy here, in one place.
 */

export type ActionResult =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export const idleActionResult: ActionResult = { status: "idle" };

const DOMAIN_ERROR_MESSAGES: Record<string, string> = {
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
  CREDENTIAL_UNAVAILABLE:
    "No credentials available for this program - connect a vault or enter the balance manually.",
};

export function messageForDomainError(code: string): string {
  return DOMAIN_ERROR_MESSAGES[code] ?? "Something went wrong. Please try again.";
}
