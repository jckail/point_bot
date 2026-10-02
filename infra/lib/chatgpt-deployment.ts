/** Validate operator-provided OAuth registration without reading any credential. */
export function chatGptDeployment(context: (key: string) => unknown): {
  environment: Record<string, string>;
  confidential: boolean;
} | undefined {
  const enabled = context("enableChatGptLinking");
  if (enabled !== true && enabled !== "true") return undefined;
  const text = (key: string) => {
    const value = context(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const clientId = text("chatGptClientId");
  const redirectUri = text("chatGptRedirectUri");
  const method = text("chatGptClientAuthMethod");
  if (!clientId || !redirectUri || !["none", "client_secret_basic"].includes(method)) {
    throw new Error("enableChatGptLinking requires approved chatGptClientId, registered chatGptRedirectUri and explicit chatGptClientAuthMethod=none|client_secret_basic");
  }
  let callback: URL;
  try { callback = new URL(redirectUri); }
  catch { throw new Error("chatGptRedirectUri must be the registered HTTPS /api/auth/chatgpt/callback URL"); }
  if (callback.protocol !== "https:" || callback.username || callback.password || callback.search || callback.hash
    || callback.pathname !== "/api/auth/chatgpt/callback") {
    throw new Error("chatGptRedirectUri must be the registered HTTPS /api/auth/chatgpt/callback URL without credentials, query or fragment");
  }
  return {
    environment: {
      CHATGPT_CLIENT_ID: clientId,
      CHATGPT_REDIRECT_URI: redirectUri,
      CHATGPT_CLIENT_AUTH_METHOD: method,
      APP_URL: callback.origin,
    },
    confidential: method === "client_secret_basic",
  };
}
