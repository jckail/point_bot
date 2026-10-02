import { env } from "@/env";
import type { ChatGptConfig } from "./oidc";

export function chatGptConfig(): ChatGptConfig | null {
  if (!env.CHATGPT_CLIENT_ID || !env.CHATGPT_REDIRECT_URI || !env.CHATGPT_CLIENT_AUTH_METHOD) return null;
  if (env.CHATGPT_CLIENT_AUTH_METHOD === "client_secret_basic" && !env.CHATGPT_CLIENT_SECRET) return null;
  const redirect = new URL(env.CHATGPT_REDIRECT_URI);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== "/api/auth/chatgpt/callback") return null;
  return {
    clientId: env.CHATGPT_CLIENT_ID,
    redirectUri: env.CHATGPT_REDIRECT_URI,
    authenticationMethod: env.CHATGPT_CLIENT_AUTH_METHOD,
    clientSecret: env.CHATGPT_CLIENT_SECRET,
  };
}
