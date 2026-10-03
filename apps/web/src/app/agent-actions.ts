"use server";

import { getSessionUserId } from "@/server/auth";
import {
  AccessTokenId,
  ConsentId,
  InvalidAccessTokenRequestError,
  InvalidConsentError,
  MAX_CONSENT_DAYS,
  isDomainError,
  isScope,
  ObservationId,
  userCacheTag,
} from "@pointup/core";
import { revalidatePath } from "next/cache";

import {
  messageForDomainError,
  type ActionResult,
} from "@/lib/action-result";
import { getContainer } from "@/server/container";
import { getReadCache } from "@/server/read-cache";

/** Server actions for the Agents page (tokens + consent). Session-only. */

export type CreateTokenResult =
  | ActionResult
  | { status: "created"; secret: string; tokenId: string };

export async function createAccessTokenAction(
  _previous: CreateTokenResult,
  formData: FormData,
): Promise<CreateTokenResult> {
  const userId = await getSessionUserId();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };

  const scopes = formData.getAll("scopes").map(String).filter(isScope);
  try {
    const rawTtl = formData.get("ttlDays");
    const ttl = typeof rawTtl === "string" && rawTtl.trim() !== "" ? Number(rawTtl) : Number.NaN;
    if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl < 1 || ttl > 365) {
      throw new InvalidAccessTokenRequestError("Token lifetime must be 1-365 whole days");
    }
    const { token, plaintext } = await getContainer().useCases.issueAccessToken.execute({
      userId,
      name: String(formData.get("name") ?? ""),
      scopes: scopes.length ? scopes : [],
      ttlDays: ttl,
    });
    revalidatePath("/dashboard/agents");
    return { status: "created", secret: plaintext, tokenId: token.id };
  } catch (error) {
    if (isDomainError(error)) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}

async function toAgentActionResult(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run();
    return { status: "success" };
  } catch (error) {
    if (isDomainError(error)) return { status: "error", message: messageForDomainError(error.code) };
    throw error;
  }
}

export async function revokeAccessTokenAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };
  const result = await toAgentActionResult(async () => {
    await getContainer().useCases.revokeAccessToken.execute(
      userId,
      AccessTokenId.parse(String(formData.get("tokenId") ?? "")),
    );
  });
  if (result.status === "success") revalidatePath("/dashboard/agents");
  return result;
}

export async function grantConsentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };
  try {
    const rawDays = formData.get("days");
    const days = typeof rawDays === "string" && rawDays.trim() !== "" ? Number(rawDays) : Number.NaN;
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1 || days > MAX_CONSENT_DAYS) {
      throw new InvalidConsentError("Consent duration must be 1-90 whole days");
    }
    await getContainer().useCases.grantConsent.execute({
      userId,
      providerId: String(formData.get("providerId") ?? ""),
      days,
    });
    revalidatePath("/dashboard/agents");
    return { status: "success" };
  } catch (error) {
    if (isDomainError(error)) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}

export async function revokeConsentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };
  const result = await toAgentActionResult(async () => {
    await getContainer().useCases.revokeConsent.execute(
      userId,
      ConsentId.parse(String(formData.get("consentId") ?? "")),
    );
  });
  if (result.status === "success") revalidatePath("/dashboard/agents");
  return result;
}

/** Human confirmation of a reading the server held as needs_review. */
export async function resolveReviewAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };
  const reviewId = String(formData.get("reviewId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  try {
    const review = getContainer().useCases.resolveObservationReview;
    if (decision !== "confirm" && decision !== "reject") return { status: "error", message: "Unknown decision." };
    try {
      await review[decision](userId, ObservationId.parse(reviewId));
    } finally {
      // Multi-method review services bypass the execute-only cache wrapper.
      await getReadCache().invalidateTag(userCacheTag(userId));
    }
    revalidatePath("/dashboard/agents");
    return { status: "success" };
  } catch (error) {
    if (isDomainError(error)) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}
