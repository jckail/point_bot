import { z } from "zod";
import { getAssistantActions, assistantActionResponse } from "@/server/assistant-agent/actions";
import { readJsonBody, withBrowserAuthenticatedUser } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ actionId: string }> }) {
  return withBrowserAuthenticatedUser(request, async userId => {
    z.object({}).strict().parse(await readJsonBody(request));
    const actionId = z.string().min(1).max(255).parse((await context.params).actionId);
    return assistantActionResponse(() => getAssistantActions().reject(actionId, userId));
  });
}
