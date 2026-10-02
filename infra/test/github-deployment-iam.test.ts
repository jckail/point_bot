import assert from "node:assert/strict";
import test from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

function template() {
  return Template.fromStack(new GithubOidcStack(new App(), "GithubOidc", {
    githubRepo: "jckail/point_bot", env: { account: "123456789012", region: "us-east-1" },
  }));
}
test("GitHub deployment trust is exact production environment, not every repository ref", () => {
  const roles = Object.values(template().findResources("AWS::IAM::Role"))
    .filter(role => role.Properties.RoleName === "pointup-github-deploy");
  assert.equal(roles.length, 1);
  const condition = roles[0]!.Properties.AssumeRolePolicyDocument.Statement[0].Condition;
  assert.equal(condition.StringEquals["token.actions.githubusercontent.com:sub"], "repo:jckail/point_bot:environment:production");
  assert.equal(condition.StringEquals["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com");
  assert.equal(condition.StringLike, undefined);
  assert.throws(() => new GithubOidcStack(new App(), "Invalid", { githubRepo: "jckail/*" }));
});
test("candidate migration permissions require purpose tags and PointUp roles/cluster", () => {
  const statements = Object.values(template().findResources("AWS::IAM::Policy"))
    .flatMap(resource => resource.Properties.PolicyDocument.Statement);
  const find = (sid: string) => statements.find(statement => statement.Sid === sid);
  assert.deepEqual(find("RegisterCandidateMigration").Condition.StringEquals, {
    "aws:RequestTag/pointup:stack": "TemplateApp", "aws:RequestTag/pointup:purpose": "migration",
  });
  assert.equal(find("PassTaskRoles").Condition.StringEquals["iam:PassedToService"], "ecs-tasks.amazonaws.com");
  assert.ok(JSON.stringify(find("PassTaskRoles").Resource).includes("role/TemplateApp-*"));
  assert.ok(JSON.stringify(find("RunMigrationTask").Condition).includes("cluster/TemplateApp-*"));
  assert.ok(!JSON.stringify(statements).includes("secretsmanager:GetSecretValue"));
  const metadata = JSON.stringify(find("InspectDatabaseSecretMetadata").Resource);
  assert.ok(metadata.includes("secret:TemplateApp*"));
  assert.ok(metadata.includes("secret:rds!db-*"));
  assert.ok(JSON.stringify(find("ExecuteBootstrapChangeSet").Resource).includes("changeSet/pointup-bootstrap-*/*"));
  assert.ok(!JSON.stringify(find("ExecuteBootstrapChangeSet").Resource).includes("changeSet/*"));
  assert.equal(find("InspectMigrationRoles"), undefined);
  assert.ok(!JSON.stringify(statements).includes('"Action":"*"'));
});
