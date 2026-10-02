import { z } from "zod";
import { userCacheTag } from "@pointup/core";
import { getAssistantActions, assistantActionResponse } from "@/server/assistant-agent/actions";
import { withAuthenticatedUser } from "@/server/http";
import { readJsonBody } from "@/server/request-body";
import { getReadCache } from "@/server/read-cache";

export function POST(request: Request, context: { params: Promise<{ actionId: string }> }) {
  return withAuthenticatedUser(async userId => {
    // The persisted proposal is the sole authority; replacement values are refused.
    z.object({}).strict().parse(await readJsonBody(request));
    const actionId = z.string().min(1).max(255).parse((await context.params).actionId);
    let response;
    try {
      response = await assistantActionResponse(() => getAssistantActions().approve(actionId, userId));
    } finally {
      // This multi-method service bypasses the execute-only cache wrapper.
      // A committed write with an unknown outcome must also drop stale reads.
      await getReadCache().invalidateTag(userCacheTag(userId));
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }, { method: "POST", scope: "portfolio:write", sessionOnly: true });
}
