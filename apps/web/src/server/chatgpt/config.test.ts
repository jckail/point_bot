import { beforeEach, describe, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => ({ AUTH_PROVIDER: "clerk", CHATGPT_CLIENT_ID: "oaiapp_synthetic", CHATGPT_REDIRECT_URI: "https://pointup.test/api/auth/chatgpt/callback", CHATGPT_CLIENT_AUTH_METHOD: "none", CHATGPT_CLIENT_SECRET: "" }));
vi.mock("@/env", () => ({ env: settings }));
import { chatGptConfig } from "./config";
beforeEach(() => { Object.assign(settings, { AUTH_PROVIDER: "clerk", CHATGPT_CLIENT_ID: "oaiapp_synthetic", CHATGPT_REDIRECT_URI: "https://pointup.test/api/auth/chatgpt/callback", CHATGPT_CLIENT_AUTH_METHOD: "none", CHATGPT_CLIENT_SECRET: "" }); });
describe("ChatGPT client configuration", () => {
  it("requires Clerk session authority and complete client registration", () => {
    expect(chatGptConfig()).toMatchObject({ clientId: "oaiapp_synthetic", authenticationMethod: "none" });
    settings.AUTH_PROVIDER = "dev";
    expect(chatGptConfig()).toBeNull();
    settings.AUTH_PROVIDER = "clerk";
    settings.CHATGPT_CLIENT_ID = "";
    expect(chatGptConfig()).toBeNull();
  });
  it.each(["http://pointup.test/api/auth/chatgpt/callback", "https://pointup.test/other", "https://user:password@pointup.test/api/auth/chatgpt/callback", "https://pointup.test/api/auth/chatgpt/callback?query=1", "https://pointup.test/api/auth/chatgpt/callback#fragment"])("rejects unsafe callback registration %s", redirectUri => {
    settings.CHATGPT_REDIRECT_URI = redirectUri;
    expect(chatGptConfig()).toBeNull();
  });
  it("requires a secret only for confidential clients", () => {
    settings.CHATGPT_CLIENT_AUTH_METHOD = "client_secret_basic";
    expect(chatGptConfig()).toBeNull();
    settings.CHATGPT_CLIENT_SECRET = "synthetic-client-secret";
    expect(chatGptConfig()).toMatchObject({ authenticationMethod: "client_secret_basic" });
  });
});
