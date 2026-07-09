"use server";

import { auth } from "@clerk/nextjs/server";
import { DomainError } from "@pointup/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  messageForDomainError,
  type ActionResult,
} from "@/lib/action-result";
import { getContainer } from "@/server/container";

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
    if (error instanceof DomainError) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}

export async function linkLoyaltyAccountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { userId } = await auth();
  if (!userId) return UNAUTHENTICATED;

  const result = await toActionResult(async () => {
    await getContainer().useCases.linkLoyaltyAccount.execute({
      userId,
      providerId: String(formData.get("providerId") ?? ""),
      membershipNumber: String(formData.get("membershipNumber") ?? ""),
    });
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function syncLoyaltyAccountAction(
  formData: FormData,
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  const accountId = String(formData.get("accountId") ?? "");
  try {
    await getContainer().useCases.syncLoyaltyAccount.execute({
      userId,
      accountId,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      console.warn(`syncLoyaltyAccount rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/accounts/${accountId}`);
}

export async function syncAllLoyaltyAccountsAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  await getContainer().useCases.syncAllLoyaltyAccounts.execute(userId);
  revalidatePath("/dashboard");
}

export async function recordManualBalanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { userId } = await auth();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  const points = Number(formData.get("points") ?? Number.NaN);

  // Optional backfill date from an <input type="date">; anchor to midday UTC
  // so the calendar day survives timezone conversion.
  const capturedOn = String(formData.get("capturedOn") ?? "");
  const capturedAt = capturedOn
    ? new Date(`${capturedOn}T12:00:00.000Z`)
    : undefined;

  const result = await toActionResult(async () => {
    await getContainer().useCases.recordManualBalance.execute({
      userId,
      accountId,
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
  const { userId } = await auth();
  if (!userId) return UNAUTHENTICATED;

  const accountId = String(formData.get("accountId") ?? "");
  const result = await toActionResult(async () => {
    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId,
      membershipNumber: String(formData.get("membershipNumber") ?? ""),
    });
  });

  if (result.status === "success") {
    revalidatePath(`/dashboard/accounts/${accountId}`);
  }
  return result;
}

export async function unlinkLoyaltyAccountAction(
  formData: FormData,
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  try {
    await getContainer().useCases.unlinkLoyaltyAccount.execute(
      userId,
      String(formData.get("accountId") ?? ""),
    );
  } catch (error) {
    if (error instanceof DomainError) {
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
  const { userId } = await auth();
  if (!userId) return UNAUTHENTICATED;

  const accountIds = formData
    .getAll("accountIds")
    .map((value) => String(value))
    .filter(Boolean);
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
  formData: FormData,
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  try {
    await getContainer().useCases.deleteTripGoal.execute(
      userId,
      String(formData.get("goalId") ?? ""),
    );
  } catch (error) {
    if (error instanceof DomainError) {
      console.warn(`deleteTripGoal rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
}

export async function importPortfolioAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { userId } = await auth();
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
  const { userId } = await auth();
  if (!userId) return;

  try {
    await getContainer().useCases.seedDemoPortfolio.execute(userId);
  } catch (error) {
    if (error instanceof DomainError) {
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
  const { userId } = await auth();
  if (!userId) return;

  const accountId = String(formData.get("accountId") ?? "");
  const pinned = String(formData.get("pinned") ?? "") === "true";

  try {
    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId,
      pinned,
    });
  } catch (error) {
    if (error instanceof DomainError) {
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
  const { userId } = await auth();
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
      accountId,
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
  formData: FormData,
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  try {
    await getContainer().useCases.restoreLoyaltyAccount.execute(
      userId,
      String(formData.get("accountId") ?? ""),
    );
  } catch (error) {
    if (error instanceof DomainError) {
      console.warn(`restoreLoyaltyAccount rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
}

export async function createPortfolioShareAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { userId } = await auth();
  if (!userId) return UNAUTHENTICATED;

  const label = String(formData.get("label") ?? "").trim();
  const expiresRaw = String(formData.get("expiresInDays") ?? "").trim();
  const expiresInDays = expiresRaw ? Number(expiresRaw) : null;

  const result = await toActionResult(async () => {
    await getContainer().useCases.createPortfolioShare.execute({
      userId,
      label: label.length > 0 ? label : null,
      expiresInDays:
        expiresInDays && Number.isFinite(expiresInDays)
          ? expiresInDays
          : null,
    });
  });

  if (result.status === "success") revalidatePath("/dashboard");
  return result;
}

export async function revokePortfolioShareAction(
  formData: FormData,
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  try {
    await getContainer().useCases.revokePortfolioShare.execute(
      userId,
      String(formData.get("shareId") ?? ""),
    );
  } catch (error) {
    if (error instanceof DomainError) {
      console.warn(`revokePortfolioShare rejected: ${error.code}`);
      return;
    }
    throw error;
  }

  revalidatePath("/dashboard");
}
