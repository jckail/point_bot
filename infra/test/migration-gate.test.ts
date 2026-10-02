import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AppStack } from "../lib/app-stack.js";

test("migration provider lifecycle handles retries and fails closed", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      "test",
      "-p",
      "migration_gate_test.py",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("web, bot and worker rules depend on successful migration with scoped permissions", () => {
  const stack = new AppStack(
    new App({ context: { enableBot: true } }),
    "MigrationRollout",
  );
  const template = Template.fromStack(stack);
  const gates = Object.entries(
    template.findResources("Custom::PointUpMigrationGate"),
  );
  assert.equal(gates.length, 1);
  const [gateId, gate] = gates[0]!;
  assert.match(gate.Properties.ImageHash, /^[a-f0-9]{64}$/);
  assert.match(gate.Properties.HandlerHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(gate.Properties.EssentialContainerNames, ["Migrate"]);
  assert.equal(gate.Properties.SubnetIds.length, 2);
  assert.equal(gate.Properties.SecurityGroupIds.length, 1);
  const services = Object.values(template.findResources("AWS::ECS::Service"));
  assert.equal(services.length, 2);
  for (const service of services) assert.ok(service.DependsOn.includes(gateId));
  const rules = Object.values(template.findResources("AWS::Events::Rule"));
  assert.equal(rules.length, 4);
  for (const rule of rules) assert.ok(rule.DependsOn.includes(gateId));
  // Template.fromStack detects cycles. Gate must never depend on consumers.
  for (const consumer of Object.keys(
    template.findResources("AWS::ECS::Service"),
  )) {
    assert.ok(!gate.DependsOn.includes(consumer));
  }
  const handlers = Object.values(
    template.findResources("AWS::Lambda::Function"),
  ).filter((resource) =>
    String(resource.Properties.Handler).startsWith("migration_gate."),
  );
  assert.equal(handlers.length, 2);
  for (const handler of handlers)
    assert.equal(handler.Properties.Runtime, "python3.13");
  const policies = Object.entries(template.findResources("AWS::IAM::Policy"))
    .filter(([id]) => id.includes("MigrationGate"))
    .map(([, resource]) => resource);
  const statements = policies.flatMap(
    (resource) => resource.Properties.PolicyDocument.Statement,
  );
  const hasAction = (
    statement: { Action: string | string[] },
    action: string,
  ) =>
    Array.isArray(statement.Action)
      ? statement.Action.includes(action)
      : statement.Action === action;
  const run = statements.find(
    (statement) =>
      hasAction(statement, "ecs:RunTask") && statement.Condition?.ArnEquals,
  );
  assert.deepEqual(run.Resource, gate.Properties.TaskDefinitionArn);
  const describe = statements.find((statement) =>
    hasAction(statement, "ecs:DescribeTasks"),
  );
  assert.ok(describe);
  assert.notEqual(describe.Resource, "*");
  assert.match(JSON.stringify(describe.Resource), /task\//);
  const pass = statements.find(
    (statement) =>
      hasAction(statement, "iam:PassRole") &&
      statement.Condition?.StringEquals?.["iam:PassedToService"] ===
        "ecs-tasks.amazonaws.com" &&
      Array.isArray(statement.Resource) &&
      statement.Resource.length === 2,
  );
  assert.ok(pass);
  const taskDefinition = template.findResources("AWS::ECS::TaskDefinition")[
    gate.Properties.TaskDefinitionArn.Ref
  ]!;
  assert.deepEqual(pass.Resource, [
    taskDefinition.Properties.TaskRoleArn,
    taskDefinition.Properties.ExecutionRoleArn,
  ]);
  assert.deepEqual(
    run.Condition.ArnEquals["ecs:cluster"],
    gate.Properties.ClusterArn,
  );
  assert.deepEqual(
    describe.Condition.ArnEquals["ecs:cluster"],
    gate.Properties.ClusterArn,
  );
});
