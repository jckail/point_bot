import { NextResponse } from "next/server";
import { getAgentServices } from "@/server/agents/container";
import { grantConsentSchema } from "@/server/agents/schemas";
import { readJsonBody, withBrowserAuthenticatedUser } from "@/server/http";
export function GET(request: Request) {
  return withBrowserAuthenticatedUser(request, async (userId) => NextResponse.json(await getAgentServices().listConsents.execute(userId)));
}
export function POST(request: Request) {
  return withBrowserAuthenticatedUser(request, async (userId) => {
    const body = grantConsentSchema.parse(await readJsonBody(request));
    return NextResponse.json(await getAgentServices().grantConsent.execute({ userId, ...body }), { status: 201 });
  });
}
