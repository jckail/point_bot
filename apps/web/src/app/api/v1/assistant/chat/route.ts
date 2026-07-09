import { chatAssistantRequestSchema } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Grounded portfolio chat via the LlmAssistant port. */
export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = chatAssistantRequestSchema.parse(await request.json());
    const result = await getContainer().useCases.chatWithAssistant.execute({
      userId,
      message: body.message,
      history: body.history,
    });
    return NextResponse.json({ reply: result.reply });
  });
}
