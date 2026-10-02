import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { chatGptConfig } from "@/server/chatgpt/config";
import { discoverOpenAi, tokenRequest, TRANSACTION_COOKIE, validateCallback, verifyIdentity } from "@/server/chatgpt/oidc";
import { consumeTransaction, linkIdentity } from "@/server/chatgpt/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = chatGptConfig();
  if (!config) {
    const response = NextResponse.json({ error: "ChatGPT account linking is not configured." }, { status: 503 });
    response.cookies.set(TRANSACTION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  }
  let result = "error";
  let stage = "transaction";
  try {
    const browserId = request.cookies.get(TRANSACTION_COOKIE)?.value;
    if (!browserId || !/^[A-Za-z0-9_-]{43}$/.test(browserId)) throw new Error("Missing authorization transaction.");
    const saved = await consumeTransaction(browserId);
    const { userId } = await auth();
    const { code, transaction } = validateCallback(saved, request.nextUrl, userId);
    if (transaction.redirectUri !== config.redirectUri) throw new Error("Authorization configuration changed.");
    stage = "discovery";
    const discovery = await discoverOpenAi();
    stage = "token-exchange";
    const tokenResponse = await fetch(discovery.token_endpoint, tokenRequest(config, code, transaction));
    if (!tokenResponse.ok) {
      const rawRequestId = tokenResponse.headers.get("openai-request-id") ?? tokenResponse.headers.get("x-request-id");
      const requestId = rawRequestId && /^[A-Za-z0-9_-]{1,128}$/.test(rawRequestId) ? rawRequestId : undefined;
      console.warn("ChatGPT token exchange failed", { status: tokenResponse.status, requestId });
      throw new Error("Token exchange failed.");
    }
    const tokens: unknown = await tokenResponse.json();
    if (!tokens || typeof tokens !== "object" || !("id_token" in tokens) || typeof tokens.id_token !== "string") throw new Error("Missing ID token.");
    stage = "identity-verification";
    const identity = await verifyIdentity(tokens.id_token, transaction.nonce, config.clientId, discovery);
    stage = "identity-linking";
    await linkIdentity(identity, transaction.userId);
    result = "linked";
  } catch {
    console.warn("ChatGPT account linking failed", { stage });
    // No provider errors, authorization codes, tokens, or verifiers reach logs/UI.
  }
  const destination = new URL(`/dashboard/settings?chatgpt=${result}`, config.redirectUri);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(TRANSACTION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
