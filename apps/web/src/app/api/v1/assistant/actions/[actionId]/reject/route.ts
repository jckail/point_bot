import { z } from "zod";
import { getAssistantActions, assistantActionResponse } from "@/server/assistant-agent/actions";
import { withAuthenticatedUser } from "@/server/http";
import { readJsonBody } from "@/server/request-body";

export function POST(request: Request, context: { params: Promise<{ actionId: string }> }) {
  return withAuthenticatedUser(async userId => {
    z.object({}).strict().parse(await readJsonBody(request));
    const actionId = z.string().min(1).max(255).parse((await context.params).actionId);
    const response = await assistantActionResponse(() => getAssistantActions().reject(actionId, userId));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }, { method: "POST", scope: "portfolio:write", sessionOnly: true });
}
