import { NextResponse } from "next/server";
import { AssistantActionNotFoundError, DrizzleAssistantActionRepository, ManageAssistantActions } from "@pointup/core/assistant-actions";
import { getContainer } from "../container";

export function getAssistantActions() {
  const container = getContainer();
  return new ManageAssistantActions(new DrizzleAssistantActionRepository(container.db), container.useCases, undefined, event => console.info(JSON.stringify({ component: "pointup_assistant_actions", ...event })));
}

/** Preserve owner privacy with the same 404 response for missing and foreign proposals. */
export async function assistantActionResponse(operation: () => Promise<unknown>) {
  try { return NextResponse.json({ action: await operation() }); }
  catch (error) {
    if (error instanceof AssistantActionNotFoundError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 404 });
    throw error;
  }
}
