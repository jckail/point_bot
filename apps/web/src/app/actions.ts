"use server";

import { getSessionUserId } from "@/server/auth";
import { isDomainError, InvalidValuationError, LoyaltyAccountId, ShareId, TripGoalId, type CardProductId } from "@pointup/core";
import { createPortfolioShareRequestSchema, setCustomValuationRequestSchema } from "@pointup/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  messageForDomainError,
  type ActionResult,
} from "@/lib/action-result";
import { getContainer } from "@/server/container";
import { manualCaptureDate } from "@/lib/manual-capture-date";

/**
 * Server actions used by the web dashboard. Like the API route handlers,
 * they are thin controllers: authenticate, delegate to a use case, refresh.
 * Form actions consumed via `useActionState` return an `ActionResult` so the
 * UI can show inline success/error feedback instead of failing silently.
 */

const UNAUTHENTICATED: ActionResult = {
  status: "error",
  message: "Your session expired - sign in again.",
};

/** Runs a use case and folds domain errors into an ActionResult. */
async function toActionResult(
  run: () => Promise<void>,
): Promise<ActionResult> {
  try {
    await run();
    return { status: "success" };
  } catch (error) {
    if (isDomainError(error)) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}

export async function linkLoyaltyAccountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const result = await toActionResult(async () => {
    await getContainer().useCases.linkLoyaltyAccount.execute({
      userId,
      providerId: String(formData.get("providerId") ?? ""),
      membershipNumber: String(formData.get("membershipNumber") ?? ""),
      cardProductId: (String(formData.get("cardProductId") ?? "") || null) as CardProductId | null,
    });
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

/** Sync forms retain counts/feedback without exposing provider exceptions. */
export type SyncActionResult = ActionResult & { message?: string };

export async function syncLoyaltyAccountAction(
  _previous: SyncActionResult,
  formData: FormData,
): Promise<SyncActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  let ownedId: LoyaltyAccountId | undefined;
  try {
    ownedId = LoyaltyAccountId.parse(accountId);
    await getContainer().useCases.syncLoyaltyAccount.execute({ userId, accountId: ownedId });
    return { status: "success", message: "Balance updated." };
  } catch (error) {
    if (isDomainError(error)) return { status: "error", message: messageForDomainError(error.code) };
    // Unexpected failures retain the existing server-action error boundary.
    throw error;
  } finally {
    // A response can fail after commit; do not leave server readmodels stale.
    revalidatePath("/dashboard");
    if (ownedId) revalidatePath(`/dashboard/accounts/${ownedId}`);
  }
}

export async function syncAllLoyaltyAccountsAction(
  _previous: SyncActionResult,
  _formData: FormData,
): Promise<SyncActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  try {
    const outcomes = await getContainer().useCases.syncAllLoyaltyAccounts.execute(userId);
    const updated = outcomes.filter(outcome => outcome.ok).length;
    const failed = outcomes.length - updated;
    if (outcomes.length === 0) return { status: "error", message: "No linked programs to sync." };
    if (failed > 0) return { status: "error", message: `Updated ${updated} of ${outcomes.length} programs. ${failed} could not sync. Check their details or record balances manually.` };
    return { status: "success", message: `Updated ${updated} program${updated === 1 ? "" : "s"}.` };
  } catch (error) {
    if (isDomainError(error)) return { status: "error", message: `${messageForDomainError(error.code)} Some balances may have changed. Check your portfolio before trying again.` };
    // No complete SyncOutcome[] exists here: some workers may have committed.
    // Propagate unexpected faults rather than inventing successful/failed counts.
    throw error;
  } finally {
    revalidatePath("/dashboard");
  }
}

export async function recordManualBalanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  const points = Number(formData.get("points") ?? Number.NaN);

  // Historical calendar dates use noon UTC; today's date must not invent
  // a future instant before noon. The core still enforces capture-time safety.
  const capturedAt = manualCaptureDate(String(formData.get("capturedOn") ?? ""));
  if (capturedAt === null) return { status: "error", message: "Choose a valid UTC date that is not in the future." };

  const result = await toActionResult(async () => {
    await getContainer().useCases.recordManualBalance.execute({
      userId,
      accountId: LoyaltyAccountId.parse(accountId),
      points,
      capturedAt,
    });
  });

  if (result.status === "success") {
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/accounts/${accountId}`);
  }
  return result;
}

export async function updateMembershipNumberAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  const result = await toActionResult(async () => {
    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId: LoyaltyAccountId.parse(accountId),
      membershipNumber: String(formData.get("membershipNumber") ?? ""),
    });
  });

  if (result.status === "success") {
    revalidatePath(`/dashboard/accounts/${accountId}`);
  }
  return result;
}

export async function updateCardProductAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;
  const accountId = String(formData.get("accountId") ?? "");
  const result = await toActionResult(async () => {
    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId: LoyaltyAccountId.parse(accountId),
      cardProductId: (String(formData.get("cardProductId") ?? "") || null) as CardProductId | null,
    });
  });
  if (result.status === "success") {
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/accounts/${accountId}`);
  }
  return result;
}

export async function unlinkLoyaltyAccountAction(
  formData: FormData,
): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) return;

  try {
    await getContainer().useCases.unlinkLoyaltyAccount.execute(
      userId,
      LoyaltyAccountId.parse(String(formData.get("accountId") ?? "")),
    );
  } catch (error) {
    if (isDomainError(error)) {
      console.warn(`unlinkLoyaltyAccount rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function createTripGoalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const accountIds = formData
    .getAll("accountIds")
    .map((value) => String(value))
    .filter(Boolean)
    .map((value) => LoyaltyAccountId.parse(value));
  const targetDateRaw = String(formData.get("targetDate") ?? "").trim();
  const targetPoints = Number(formData.get("targetPoints") ?? Number.NaN);

  const result = await toActionResult(async () => {
    await getContainer().useCases.createTripGoal.execute({
      userId,
      title: String(formData.get("title") ?? ""),
      targetPoints,
      targetDate: targetDateRaw.length > 0 ? targetDateRaw : null,
      accountIds,
    });
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function deleteTripGoalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const result = await toActionResult(async () => {
    await getContainer().useCases.deleteTripGoal.execute(
      userId,
      TripGoalId.parse(String(formData.get("goalId") ?? "")),
    );
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function importPortfolioAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const result = await toActionResult(async () => {
    await getContainer().useCases.importPortfolio.execute({
      userId,
      csv: String(formData.get("csv") ?? ""),
    });
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function seedDemoPortfolioAction(): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) return;

  try {
    await getContainer().useCases.seedDemoPortfolio.execute(userId);
  } catch (error) {
    if (isDomainError(error)) {
      console.warn(`seedDemoPortfolio rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
}

export async function togglePinAccountAction(
  formData: FormData,
): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) return;

  const accountId = String(formData.get("accountId") ?? "");
  const pinned = String(formData.get("pinned") ?? "") === "true";

  try {
    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId: LoyaltyAccountId.parse(accountId),
      pinned,
    });
  } catch (error) {
    if (isDomainError(error)) {
      console.warn(`togglePinAccount rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/accounts/${accountId}`);
}

export async function updateAccountNotesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  const notesRaw = String(formData.get("notes") ?? "");
  const tagsRaw = String(formData.get("tags") ?? "");
  const tags = tagsRaw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const result = await toActionResult(async () => {
    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId: LoyaltyAccountId.parse(accountId),
      notes: notesRaw.trim().length > 0 ? notesRaw : null,
      tags,
    });
  });

  if (result.status === "success") {
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/accounts/${accountId}`);
  }
  return result;
}

export async function restoreLoyaltyAccountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const result = await toActionResult(async () => {
    await getContainer().useCases.restoreLoyaltyAccount.execute(
      userId,
      LoyaltyAccountId.parse(String(formData.get("accountId") ?? "")),
    );
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function createPortfolioShareAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const label = String(formData.get("label") ?? "").trim();
  const expiresRaw = String(formData.get("expiresInDays") ?? "").trim();
  const parsed = createPortfolioShareRequestSchema.safeParse({
    label: label.length > 0 ? label : null,
    expiresInDays: expiresRaw === "" ? null : Number(expiresRaw),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues.some(issue => issue.path[0] === "label")
    ? "Share label must be at most 80 characters." : messageForDomainError("INVALID_SHARE_EXPIRY") };

  const result = await toActionResult(async () => {
    await getContainer().useCases.createPortfolioShare.execute({
      userId,
      ...parsed.data,
    });
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function revokePortfolioShareAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const result = await toActionResult(async () => {
    await getContainer().useCases.revokePortfolioShare.execute(
      userId,
      ShareId.parse(String(formData.get("shareId") ?? "")),
    );
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function updateAccountValuationAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  const result = await toActionResult(async () => {
    const intent = String(formData.get("intent") ?? "");
    if (intent !== "save" && intent !== "reset") throw new InvalidValuationError();

    const { useCases } = getContainer();
    const account = await useCases.getLoyaltyAccount.execute(
      userId,
      LoyaltyAccountId.parse(accountId),
    );
    // The owned account supplies the provider; never trust a submitted provider
    // or owner. Valuations remain per user/program, not per account/card.
    if (intent === "reset") {
      await useCases.deleteCustomValuation.execute(userId, account.provider.id);
      return;
    }

    const parsed = setCustomValuationRequestSchema.safeParse({
      centsPerPoint: Number(String(formData.get("centsPerPoint") ?? "").trim()),
    });
    if (!parsed.success) throw new InvalidValuationError();
    await useCases.setCustomValuation.execute({
      userId,
      providerId: account.provider.id,
      centsPerPoint: parsed.data.centsPerPoint,
    });
  });

  if (result.status === "success") {
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/accounts/${accountId}`);
  }
  return result;
}
