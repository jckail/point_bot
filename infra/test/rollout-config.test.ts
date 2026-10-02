import assert from "node:assert/strict";
import test from "node:test";
import { assertRegionalCertificate, deploymentMode, rolloutConfig } from "../lib/rollout-config.js";
import { webTlsContext } from "./rollout-fixture.js";

const config = (overrides: Record<string, unknown> = {}) => {
  const context: Record<string, unknown> = { ...webTlsContext, ...overrides };
  return rolloutConfig(key => context[key]);
};
test("OIDC-only bootstrap is explicit and does not require application TLS inputs", () => {
  const select = (context: Record<string, unknown>) => deploymentMode(key => context[key]);
  assert.equal(select({}), "application");
  assert.equal(select({ githubRepo: "owner/repository" }), "application");
  assert.equal(select({ deploymentMode: "oidc", githubRepo: "owner/repository" }), "oidc");
  assert.throws(() => select({ deploymentMode: "oidc" }), /requires githubRepo/);
  assert.throws(() => select({ deploymentMode: "oidc", githubRepo: "owner/repository", bootstrapInactive: "true" }), /cannot select application/);
  assert.throws(() => select({ deploymentMode: "unknown", githubRepo: "owner/repository" }), /application or oidc/);
});
test("active is the default and MCP uses the canonical HTTPS web origin", () => {
  assert.deepEqual(config(), { bootstrapInactive: false, ...webTlsContext, webOrigin: "https://pointup.test", mcpPointupUrl: "https://pointup.test" });
});
test("inactive bootstrap requires the paired explicit absence assertion", () => {
  assert.throws(() => config({ bootstrapInactive: true }), /ConfirmedAbsent/);
  assert.throws(() => config({ bootstrapStackConfirmedAbsent: true }), /existing-stack upgrades/);
  assert.throws(() => config({ bootstrapInactive: "yes" }), /explicitly true or false/);
  assert.equal(config({ bootstrapInactive: "true", bootstrapStackConfirmedAbsent: "true" }).bootstrapInactive, true);
  assert.equal(config({ bootstrapInactive: "false", bootstrapStackConfirmedAbsent: "false" }).bootstrapInactive, false);
});
test("web public TLS inputs are mandatory and accept only certificate/DNS configuration", () => {
  for (const webCertificateArn of [undefined, "", "http://example.test", "arn:aws:iam::111111111111:role/example"]) {
    assert.throws(() => config({ webCertificateArn }), /webCertificateArn/);
  }
  for (const webDomainName of [undefined, "", "localhost", "127.0.0.1", "https://pointup.test", "pointup.test:443", "pointup.test/path"]) {
    assert.throws(() => config({ webDomainName }), /webDomainName/);
  }
});
test("MCP overrides must remain HTTPS origins without embedded credentials", () => {
  assert.equal(config({ mcpPointupUrl: "https://api.pointup.test/" }).mcpPointupUrl, "https://api.pointup.test");
  for (const mcpPointupUrl of ["http://pointup.test", "https://user:secret@pointup.test", "https://pointup.test/api", "https://pointup.test/?token=x", "https://pointup.test/#x", "invalid"]) {
    assert.throws(() => config({ mcpPointupUrl }), /approved HTTPS origin/);
  }
});
test("certificate configuration must match a concrete deployment account and region", () => {
  const context: Record<string, unknown> = webTlsContext;
  assert.throws(() => rolloutConfig(key => context[key], { account: "222222222222", region: "us-east-1" }), /deployment account and region/);
  assert.throws(() => rolloutConfig(key => context[key], { account: "111111111111", region: "eu-west-1" }), /deployment account and region/);
  assert.doesNotThrow(() => assertRegionalCertificate(webTlsContext.webCertificateArn, { account: "111111111111", region: "us-east-1" }));
});
