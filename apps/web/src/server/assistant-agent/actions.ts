import { NextResponse } from "next/server";
import { AssistantActionNotFoundError } from "@pointup/core/assistant-actions";
import { getContainer } from "../container";

export function getAssistantActions() {
  const actions = getContainer().useCases.manageAssistantActions;
  if (!actions) throw new Error("Assistant actions are not configured.");
  return actions;
}

/** Preserve owner privacy with the same 404 response for missing and foreign proposals. */
export async function assistantActionResponse(operation: () => Promise<unknown>) {
  try { return NextResponse.json({ action: await operation() }); }
  catch (error) {
    if (error instanceof AssistantActionNotFoundError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 404 });
    throw error;
  }
}
