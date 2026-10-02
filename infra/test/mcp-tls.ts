import assert from "node:assert/strict";

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { webTlsContext } from "./rollout-fixture.js";
import { AppStack } from "../lib/app-stack.js";

const env = { account: "111111111111", region: "us-east-1" };
const CERT = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000";

function synth(context: Record<string, string | boolean>) {
  const app = new cdk.App({ context: { ...webTlsContext, ...context } });
  const stack = new AppStack(app, "T", { env });
  return Template.fromStack(stack);
}

// enableMcp without TLS must refuse to synth.
assert.throws(() => synth({ enableMcp: true }), /mcpCertificateArn/);
assert.throws(() => synth({ enableMcp: true, mcpCertificateArn: CERT }), /mcpDomainName/);
assert.throws(() => synth({ enableMcp: true, mcpDomainName: "mcp.example.com" }), /mcpCertificateArn/);

// Disabled: no MCP resources, no throw.
const off = synth({});
assert.equal(JSON.stringify(off.toJSON()).includes("McpService"), false);

// Enabled with cert + domain: HTTPS listener exists and Host allow-list is set.
const on = synth({ enableMcp: true, mcpCertificateArn: CERT, mcpDomainName: "mcp.example.com" });
on.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Protocol: "HTTPS" });
assert.match(JSON.stringify(on.toJSON()), /MCP_ALLOWED_HOSTS/);
on.hasResourceProperties("AWS::ECS::TaskDefinition", {
  ContainerDefinitions: Match.arrayWith([
    Match.objectLike({ Environment: Match.arrayWith([
      { Name: "MCP_PUBLIC_URL", Value: "https://mcp.example.com" },
    ]) }),
  ]),
});

console.log("mcp-tls synth checks passed");
