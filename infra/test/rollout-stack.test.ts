import assert from "node:assert/strict";
import test from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AppStack } from "../lib/app-stack.js";
import { webTlsContext } from "./rollout-fixture.js";

const context = { ...webTlsContext, enableBot: true, enableMcp: true,
  mcpCertificateArn: webTlsContext.webCertificateArn, mcpDomainName: "mcp.pointup.test",
  enableAggregator: true, aggregatorApiUrl: "https://provider.test" };
function template(inactive: boolean) {
  return Template.fromStack(new AppStack(new App({ context: { ...context,
    bootstrapInactive: inactive, bootstrapStackConfirmedAbsent: inactive } }), "TemplateApp",
  { env: { account: "111111111111", region: "us-east-1" } }));
}
test("rejects unsafe aggregator configuration before publishing task environments", () => {
  for (const aggregatorApiUrl of ["bad", "http://provider.test", "https://user:secret@provider.test", "https://provider.test?token=secret", "https://provider.test?", "https://provider.test#", "https://provider.test\\path"]) {
    assert.throws(() => new AppStack(new App({ context: { ...context, aggregatorApiUrl } }), "InvalidAggregator",
      { env: { account: "111111111111", region: "us-east-1" } }), /Aggregator API URL/);
  }
});
test("inactive first creation preserves all resource IDs while preventing any workload activation", () => {
  const active = template(false);
  const inactive = template(true);
  assert.deepEqual(Object.keys(active.toJSON().Resources).sort(), Object.keys(inactive.toJSON().Resources).sort());
  const services = Object.values(inactive.findResources("AWS::ECS::Service"));
  assert.equal(services.length, 3);
  for (const service of services) assert.equal(service.Properties.DesiredCount, 0);
  assert.deepEqual(Object.values(active.findResources("AWS::ECS::Service")).map(service => service.Properties.DesiredCount).sort(), [1, 1, 2]);
  const targets = Object.values(inactive.findResources("AWS::ApplicationAutoScaling::ScalableTarget"));
  assert.equal(targets.length, 1);
  for (const target of targets) {
    assert.equal(target.Properties.MinCapacity, 0);
    assert.equal(target.Properties.MaxCapacity, 0);
    assert.deepEqual(target.Properties.SuspendedState, { DynamicScalingInSuspended: true, DynamicScalingOutSuspended: true, ScheduledScalingSuspended: true });
  }
  const rules = Object.values(inactive.findResources("AWS::Events::Rule"));
  assert.equal(rules.length, 4);
  for (const rule of rules) assert.equal(rule.Properties.State, "DISABLED");
  for (const rule of Object.values(active.findResources("AWS::Events::Rule"))) assert.equal(rule.Properties.State, "ENABLED");
  assert.equal(inactive.toJSON().Outputs.DeploymentPhase.Value, "inactive-bootstrap");
  assert.equal(active.toJSON().Outputs.DeploymentPhase.Value, "active");
  for (const type of ["AWS::EC2::VPC", "AWS::RDS::DBInstance", "AWS::IAM::Role", "AWS::Logs::LogGroup"]) {
    assert.deepEqual(active.findResources(type), inactive.findResources(type));
  }
});
test("migration container has only database secrets and retains its existing command", () => {
  const tasks = Object.values(template(false).findResources("AWS::ECS::TaskDefinition"));
  const migration = tasks.flatMap(task => task.Properties.ContainerDefinitions).find(container => container.Name === "Migrate");
  assert.ok(migration);
  assert.deepEqual(migration.Command, ["migrate"]);
  assert.deepEqual(migration.Secrets.map((secret: { Name: string }) => secret.Name).sort(), ["DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT", "DB_USER"]);
  assert.deepEqual(migration.Environment, [{ Name: "NODE_ENV", Value: "production" }]);
});
test("web listener redirects HTTP and MCP uses canonical encrypted upstream", () => {
  const stack = template(false);
  const listeners = Object.entries(stack.findResources("AWS::ElasticLoadBalancingV2::Listener"));
  assert.ok(listeners.some(([id, resource]) => id.startsWith("Service") && resource.Properties.Protocol === "HTTPS" && resource.Properties.Port === 443));
  assert.ok(listeners.some(([id, resource]) => id.startsWith("Service") && resource.Properties.Protocol === "HTTP" && resource.Properties.DefaultActions.some((action: { Type: string; RedirectConfig?: { Protocol: string; Port: string } }) => action.Type === "redirect" && action.RedirectConfig?.Protocol === "HTTPS" && action.RedirectConfig?.Port === "443")));
  const containers = Object.values(stack.findResources("AWS::ECS::TaskDefinition")).flatMap(task => task.Properties.ContainerDefinitions);
  assert.ok(containers.some(container => container.Environment?.some((entry: { Name: string; Value: string }) => entry.Name === "POINTUP_URL" && entry.Value === "https://pointup.test")));
  assert.ok(containers.some(container => container.Environment?.some((entry: { Name: string; Value: string }) => entry.Name === "APP_URL" && entry.Value === "https://pointup.test")));
  assert.equal(stack.toJSON().Outputs.LoadBalancerUrl.Value, "https://pointup.test");
});
test("SIWC registration must use the canonical web origin", () => {
  assert.throws(() => new AppStack(new App({ context: { ...webTlsContext, enableChatGptLinking: true,
    chatGptClientId: "synthetic", chatGptClientAuthMethod: "none",
    chatGptRedirectUri: "https://foreign.test/api/auth/chatgpt/callback" } }), "Mismatch"), /must match/);
});
