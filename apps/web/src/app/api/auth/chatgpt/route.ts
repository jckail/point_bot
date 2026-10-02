import { randomBytes } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { chatGptConfig } from "@/server/chatgpt/config";
import { authorizationUrl, createTransaction, discoverOpenAi, OPENAI_ISSUER, TRANSACTION_COOKIE, TRANSACTION_TTL_MS } from "@/server/chatgpt/oidc";
import { linkedIdentity, saveTransaction } from "@/server/chatgpt/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const config = chatGptConfig();
  try {
    const linked = config ? await linkedIdentity(userId, config.clientId, OPENAI_ISSUER) : false;
    return NextResponse.json({ configured: !!config, linked, mode: "account-linking" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ChatGPT account linking is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

function startError(request: NextRequest, message: string, status: number) {
  if (request.headers.get("accept")?.includes("text/html")) {
    return new NextResponse(null, { status: 303, headers: { Location: "/dashboard/settings?chatgpt=error", "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const config = chatGptConfig();
  if (!config) return startError(request, "ChatGPT account linking is not configured.", 503);
  // Registered origin is authoritative; never trust a Host header to build callbacks.
  const origin = new URL(config.redirectUri).origin;
  if (request.headers.get("origin") !== origin) return startError(request, "Invalid request origin.", 403);
  try {
    const discovery = await discoverOpenAi();
    const transaction = createTransaction(userId, config.redirectUri);
    const browserId = randomBytes(32).toString("base64url");
    await saveTransaction(browserId, transaction);
    const response = NextResponse.redirect(authorizationUrl(discovery, config, transaction), 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(TRANSACTION_COOKIE, browserId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TRANSACTION_TTL_MS / 1000 });
    return response;
  } catch {
    return startError(request, "ChatGPT account linking could not start. Try again later.", 502);
  }
}
