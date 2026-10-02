import assert from "node:assert/strict";
import test from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

function synth(context: Record<string, unknown> = {}) {
  return Template.fromStack(new GithubOidcStack(new App({ context }), "GitHubTest", {
    githubRepo: "example/pointup", env: { account: "123456789012", region: "us-east-1" },
  }));
}

test("deployment role trusts only production environment and scoped bootstrap roles", () => {
  const template = synth();
  const roleEntry = Object.entries(template.findResources("AWS::IAM::Role")).find(([, resource]) => resource.Properties?.RoleName === "pointup-github-deploy");
  assert.ok(roleEntry);
  const roleProperties = roleEntry[1].Properties;
  assert.ok(roleProperties);
  const conditions = roleProperties.AssumeRolePolicyDocument.Statement[0].Condition;
  assert.deepEqual(conditions.StringEquals, {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:example/pointup:environment:production",
  });
  const policies = Object.values(template.findResources("AWS::IAM::Policy")).filter(policy => policy.Properties.Roles.some((role: { Ref?: string }) => role.Ref === roleEntry[0]));
  const statements = policies.flatMap(policy => policy.Properties.PolicyDocument.Statement);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].Action, "sts:AssumeRole");
  assert.ok(JSON.stringify(statements[0].Resource).includes("cdk-hnb659fds-*-role-123456789012-us-east-1"));
  assert.ok(!JSON.stringify(statements).includes("ecs:RunTask"));
  assert.ok(!JSON.stringify(statements).includes("iam:PassRole"));
});

test("immutable repository subjects are supported without wildcard trust", () => {
  const subject = "repo:example@123/pointup@456:environment:production";
  const template = synth({ githubOidcSubject: subject });
  assert.ok(JSON.stringify(template.findResources("AWS::IAM::Role")).includes(subject));
  for (const unsafe of ["repo:example/pointup:*", "repo:other/pointup:environment:production", "repo:example/pointup:ref:refs/heads/master"]) {
    assert.throws(() => synth({ githubOidcSubject: unsafe }), /githubOidcSubject/);
  }
});
