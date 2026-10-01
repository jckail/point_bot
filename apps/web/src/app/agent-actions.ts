"use server";

import { auth } from "@clerk/nextjs/server";
import {
  DomainError,
  isScope,
  type AccessTokenScope,
} from "@pointup/core";
import { revalidatePath } from "next/cache";

import {
  messageForDomainError,
  type ActionResult,
} from "@/lib/action-result";
import { getContainer } from "@/server/container";

/** Server actions for the Agents page (tokens + consent). Session-only. */

export type CreateTokenResult =
  | ActionResult
  | { status: "created"; secret: string };

export async function createAccessTokenAction(
  _previous: CreateTokenResult,
  formData: FormData,
): Promise<CreateTokenResult> {
  const { userId } = await auth();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };

  const scopes = formData.getAll("scopes").map(String).filter(isScope) as AccessTokenScope[];
  const ttl = Number(formData.get("ttlDays") ?? "");
  try {
    const { plaintext } = await getContainer().useCases.issueAccessToken.execute({
      userId,
      name: String(formData.get("name") ?? ""),
      scopes: scopes.length ? scopes : [],
      ttlDays: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
    });
    revalidatePath("/dashboard/agents");
    return { status: "created", secret: plaintext };
  } catch (error) {
    if (error instanceof DomainError) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}

export async function revokeAccessTokenAction(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  await getContainer().useCases.revokeAccessToken.execute(
    userId,
    String(formData.get("tokenId") ?? ""),
  );
  revalidatePath("/dashboard/agents");
}

export async function grantConsentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { userId } = await auth();
  if (!userId) return { status: "error", message: "Your session expired - sign in again." };
  try {
    await getContainer().useCases.grantConsent.execute({
      userId,
      providerId: String(formData.get("providerId") ?? ""),
      days: Number(formData.get("days") ?? 30) || 30,
    });
    revalidatePath("/dashboard/agents");
    return { status: "success" };
  } catch (error) {
    if (error instanceof DomainError) {
      return { status: "error", message: messageForDomainError(error.code) };
    }
    throw error;
  }
}

export async function revokeConsentAction(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  await getContainer().useCases.revokeConsent.execute(
    userId,
    String(formData.get("consentId") ?? ""),
  );
  revalidatePath("/dashboard/agents");
}
