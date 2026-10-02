import assert from "node:assert/strict";
import test from "node:test";
import { App, Stack } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { AssistantObservability } from "../lib/assistant-observability.js";
import { webTlsContext } from "./rollout-fixture.js";
import { AppStack } from "../lib/app-stack.js";

test("operational metrics remain aggregate and failure alarms exclude cancellations", () => {
  const stack = new Stack(new App(), "TelemetryTest");
  new AssistantObservability(stack, "Assistant", new LogGroup(stack, "Logs"));
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::Logs::MetricFilter", 14);
  template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  template.hasResourceProperties("AWS::Logs::MetricFilter", {
    FilterPattern: Match.stringLikeRegexp('pointup_assistant.*run_failed.*status != \"cancelled\"'),
    MetricTransformations: [Match.objectLike({ MetricName: "FailedRuns", MetricValue: "1" })],
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    Threshold: 20, EvaluationPeriods: 3, DatapointsToAlarm: 2, TreatMissingData: "notBreaching",
    Metrics: Match.arrayWith([Match.objectLike({ Expression: "IF(r >= 10, 100 * FILL(f, 0) / r, 0)" })]),
  });
  for (const resource of Object.values(template.findResources("AWS::Logs::MetricFilter"))) {
    for (const transform of resource.Properties.MetricTransformations) assert.equal(transform.Dimensions, undefined);
  }
  for (const [name, field] of [
    ["InputTokens", "inputTokenCount"],
    ["OutputTokens", "outputTokenCount"],
    ["CachedInputTokens", "cachedInputTokenCount"],
    ["ReasoningOutputTokens", "reasoningOutputTokenCount"],
  ]) {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: Match.stringLikeRegexp(`${field} >= 0`),
      MetricTransformations: [Match.objectLike({ MetricName: name, MetricValue: `$.${field}` })],
    });
  }
  for (const resource of Object.values(template.findResources("AWS::CloudWatch::Alarm"))) {
    assert.equal(resource.Properties.AlarmActions, undefined);
  }
  const dashboard = JSON.stringify(template.findResources("AWS::CloudWatch::Dashboard"));
  for (const field of ["p95", "requestId", "traceId", "sdkTraceId", "run_failed", "pointup_assistant_http", "httpStatus", "CachedInputTokens", "ReasoningOutputTokens"]) assert.ok(dashboard.includes(field));
});

test("Agents activation requires an explicit model", () => {
  const app = new App({ context: { ...webTlsContext, enableAgents: "true" } });
  assert.throws(() => new AppStack(app, "MissingModel"), /requires an explicit assistantModel/);
});

test("only the web task receives the Agents key and tracing requires opt-in", () => {
  const app = new App({ context: { ...webTlsContext, enableAgents: "true", assistantModel: "approved-model", enableBot: true } });
  const template = Template.fromStack(new AppStack(app, "EnabledAgents"));
  const tasks = Object.values(template.findResources("AWS::ECS::TaskDefinition"));
  const agentsContainers = tasks.flatMap(resource => resource.Properties.ContainerDefinitions).filter(container => container.Secrets?.some((secret: { Name: string }) => secret.Name === "OPENAI_API_KEY"));
  assert.equal(agentsContainers.length, 1);
  const env = Object.fromEntries(agentsContainers[0].Environment.map((entry: { Name: string; Value: string }) => [entry.Name, entry.Value]));
  assert.equal(env.ASSISTANT_RUNTIME, "agents");
  assert.equal(env.ASSISTANT_MODEL, "approved-model");
  assert.equal(env.ASSISTANT_TRACING_ENABLED, "false");
  template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
});

test("Agents tracing is independently opt-in", () => {
  const template = Template.fromStack(new AppStack(new App({ context: { ...webTlsContext,
    enableAgents: true, assistantModel: "approved-model", assistantTracing: true,
  } }), "TracingAgents"));
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    ContainerDefinitions: Match.arrayWith([Match.objectLike({
      Environment: Match.arrayWith([{ Name: "ASSISTANT_TRACING_ENABLED", Value: "true" }]),
    })]),
  });
});

test("blank model is rejected", () => {
  assert.throws(() => new AppStack(new App({ context: { ...webTlsContext,
    enableAgents: true, assistantModel: "   ",
  } }), "BlankModel"), /requires an explicit assistantModel/);
});

test("disabled Agents runtime provisions no Agents credential", () => {
  const template = Template.fromStack(new AppStack(new App({ context: { ...webTlsContext, enableAgents: "false" } }), "DisabledAgents"));
  const tasks = JSON.stringify(template.findResources("AWS::ECS::TaskDefinition"));
  assert.ok(!tasks.includes('"Name":"OPENAI_API_KEY"'));
  assert.ok(!JSON.stringify(template.findResources("AWS::SecretsManager::Secret")).includes("OpenAI Agents SDK"));
});
