import assert from "node:assert/strict";
import test from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { webTlsContext } from "./rollout-fixture.js";
import { AppStack } from "../lib/app-stack.js";

const approved = { ...webTlsContext, enableChatGptLinking: true, chatGptClientId: "synthetic-client", chatGptRedirectUri: "https://pointup.test/api/auth/chatgpt/callback", chatGptClientAuthMethod: "none", enableBot: true };
function containers(template: Template) {
  return Object.values(template.findResources("AWS::ECS::TaskDefinition")).flatMap(resource => resource.Properties.ContainerDefinitions);
}
test("public OAuth client config is web-only and provisions no confidential secret", () => {
  const template = Template.fromStack(new AppStack(new App({ context: approved }), "PublicChatGpt"));
  const configured = containers(template).filter(container => container.Environment?.some((entry: { Name: string }) => entry.Name === "CHATGPT_CLIENT_ID"));
  assert.equal(configured.length, 1);
  const env = Object.fromEntries(configured[0].Environment.map((entry: { Name: string; Value: string }) => [entry.Name, entry.Value]));
  assert.equal(env.APP_URL, "https://pointup.test");
  assert.equal(env.CHATGPT_CLIENT_AUTH_METHOD, "none");
  assert.ok(!JSON.stringify(template.findResources("AWS::SecretsManager::Secret")).includes("confidential-client secret"));
  assert.ok(!JSON.stringify(containers(template)).includes('"Name":"CHATGPT_CLIENT_SECRET"'));
});
test("confidential OAuth client secret is injected only into the configured web task", () => {
  const template = Template.fromStack(new AppStack(new App({ context: { ...approved, chatGptClientAuthMethod: "client_secret_basic" } }), "ConfidentialChatGpt"));
  const configured = containers(template).filter(container => container.Secrets?.some((entry: { Name: string }) => entry.Name === "CHATGPT_CLIENT_SECRET"));
  assert.equal(configured.length, 1);
  assert.ok(configured[0].Environment.some((entry: { Name: string }) => entry.Name === "CHATGPT_CLIENT_ID"));
  assert.ok(template.toJSON().Outputs.ChatGptClientSecretArn);
});
test("disabled ChatGPT linking creates no client environment or credential", () => {
  const template = Template.fromStack(new AppStack(new App({ context: { ...approved, enableChatGptLinking: "false" } }), "DisabledChatGpt"));
  assert.ok(!JSON.stringify(containers(template)).includes('"Name":"CHATGPT_'));
  assert.ok(!JSON.stringify(template.findResources("AWS::SecretsManager::Secret")).includes("confidential-client secret"));
});
