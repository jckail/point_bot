import { NextResponse } from "next/server";
import { getAgentServices } from "@/server/agents/container";
import { mintTokenSchema } from "@/server/agents/schemas";
import { readJsonBody, withBrowserAuthenticatedUser } from "@/server/http";

export function GET(request: Request) {
  return withBrowserAuthenticatedUser(request, async (userId) => NextResponse.json(await getAgentServices().listTokens.execute(userId)));
}
export function POST(request: Request) {
  return withBrowserAuthenticatedUser(request, async (userId) => {
    const body = mintTokenSchema.parse(await readJsonBody(request));
    const result = await getAgentServices().mintToken.execute({ userId, ...body });
    return NextResponse.json(result, { status: 201 });
  });
}
