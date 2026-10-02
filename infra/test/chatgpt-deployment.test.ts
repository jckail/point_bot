import assert from "node:assert/strict";
import test from "node:test";
import { chatGptDeployment } from "../lib/chatgpt-deployment.js";
const approved = { enableChatGptLinking: true, chatGptClientId: "synthetic-client", chatGptRedirectUri: "https://pointup.test/api/auth/chatgpt/callback", chatGptClientAuthMethod: "none" };
const config = (values: Record<string, unknown>) => chatGptDeployment(key => values[key]);
test("ChatGPT deployment stays disabled unless explicitly enabled", () => {
  for (const enabled of [undefined, false, "false", "yes", 1]) assert.equal(config({ ...approved, enableChatGptLinking: enabled }), undefined);
});
test("ChatGPT deployment requires complete explicit OAuth registration", () => {
  for (const field of ["chatGptClientId", "chatGptRedirectUri", "chatGptClientAuthMethod"]) assert.throws(() => config({ ...approved, [field]: "" }), /requires approved/);
  assert.throws(() => config({ ...approved, chatGptClientAuthMethod: "guess" }), /requires approved/);
});
test("ChatGPT callback must be registered HTTPS without ambiguous authority", () => {
  for (const uri of ["http://pointup.test/api/auth/chatgpt/callback", "https://pointup.test/other", "https://user:pass@pointup.test/api/auth/chatgpt/callback", "https://pointup.test/api/auth/chatgpt/callback?x=1", "https://pointup.test/api/auth/chatgpt/callback#x", "invalid"])
    assert.throws(() => config({ ...approved, chatGptRedirectUri: uri }), /registered HTTPS/);
});
test("client type chooses a separate confidential secret requirement", () => {
  assert.deepEqual(config(approved), { confidential: false, environment: { CHATGPT_CLIENT_ID: "synthetic-client", CHATGPT_REDIRECT_URI: approved.chatGptRedirectUri, CHATGPT_CLIENT_AUTH_METHOD: "none", APP_URL: "https://pointup.test" } });
  assert.equal(config({ ...approved, chatGptClientAuthMethod: "client_secret_basic" })?.confidential, true);
});
