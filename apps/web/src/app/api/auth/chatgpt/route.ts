import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { chatGptConfig } from "@/server/chatgpt/config";
import { authorizationUrl, createTransaction, discoverOpenAi, OPENAI_ISSUER, TRANSACTION_COOKIE, TRANSACTION_TTL_MS } from "@/server/chatgpt/oidc";
import { linkedIdentity, saveTransaction } from "@/server/chatgpt/storage";
import { withAuthenticatedUser } from "@/server/http";
import { webObservability } from "@/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export function GET() {
  return withAuthenticatedUser(async userId => {
    const config = chatGptConfig();
    try {
      const linked = config ? await linkedIdentity(userId, config.clientId, OPENAI_ISSUER) : false;
      return NextResponse.json({ configured: !!config, linked, mode: "account-linking" }, { headers: privateHeaders });
    } catch {
      return NextResponse.json({ error: "ChatGPT account linking is temporarily unavailable." }, { status: 503, headers: privateHeaders });
    }
  }, { method: "GET", scope: "portfolio:read", sessionOnly: true });
}

function startError(request: NextRequest, message: string, status: number) {
  if (request.headers.get("accept")?.includes("text/html")) {
    return new NextResponse(null, { status: 303, headers: { ...privateHeaders, Location: "/dashboard/settings?chatgpt=error" } });
  }
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

export function POST(request: NextRequest) {
  return withAuthenticatedUser(async userId => {
    const config = chatGptConfig();
    if (!config) return startError(request, "ChatGPT account linking is not configured.", 503);
    // Registered callback origin is authoritative in addition to shared CSRF checks.
    if (request.headers.get("origin") !== new URL(config.redirectUri).origin) return startError(request, "Invalid request origin.", 403);
    let stage = "discovery";
    try {
      const discovery = await discoverOpenAi();
      const transaction = createTransaction(userId, config.redirectUri);
      const browserId = randomBytes(32).toString("base64url");
      stage = "transaction-storage";
      await saveTransaction(browserId, transaction);
      const response = NextResponse.redirect(authorizationUrl(discovery, config, transaction), 303);
      for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
      response.cookies.set(TRANSACTION_COOKIE, browserId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TRANSACTION_TTL_MS / 1000 });
      return response;
    } catch {
      try { webObservability().logger.warn("chatgpt_link_start_failed", { stage }); } catch { /* observation must not affect the response */ }
      return startError(request, "ChatGPT account linking could not start. Try again later.", 502);
    }
  }, { method: "POST", scope: "portfolio:read", sessionOnly: true });
}
