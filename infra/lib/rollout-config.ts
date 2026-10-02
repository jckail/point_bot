/** OIDC bootstrap is explicitly separate; ordinary app deployment remains the default. */
export function deploymentMode(context: (key: string) => unknown): "application" | "oidc" {
  const value = context("deploymentMode");
  if (value === undefined || value === "application") return "application";
  if (value !== "oidc") throw new Error("deploymentMode must be application or oidc");
  const repository = context("githubRepo");
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("deploymentMode=oidc requires githubRepo=owner/name");
  }
  if (context("bootstrapInactive") === true || context("bootstrapInactive") === "true") {
    throw new Error("deploymentMode=oidc cannot select application inactive bootstrap");
  }
  return "oidc";
}

export function assertRegionalCertificate(arn: string, environment: { account?: string; region?: string }): void {
  const match = /^arn:aws(?:-us-gov|-cn)?:acm:([a-z0-9-]+):(\d{12}):certificate\/[a-f0-9-]{36}$/.exec(arn);
  if (!match) throw new Error("Certificate must be an approved ACM certificate ARN");
  if ((environment.region && environment.region !== match[1]) || (environment.account && environment.account !== match[2])) {
    throw new Error("ACM certificate must match the deployment account and region");
  }
}

/** Nonsecret operator configuration. Stack absence must be established by deployment tooling. */
export function rolloutConfig(context: (key: string) => unknown, environment: { account?: string; region?: string } = {}): {
  bootstrapInactive: boolean;
  webCertificateArn: string;
  webDomainName: string;
  webOrigin: string;
  mcpPointupUrl: string;
} {
  const flag = (key: string): boolean => {
    const value = context(key);
    if (value === undefined || value === false || value === "false") return false;
    if (value === true || value === "true") return true;
    throw new Error(`${key} must be explicitly true or false`);
  };
  const bootstrapInactive = flag("bootstrapInactive");
  if (bootstrapInactive !== flag("bootstrapStackConfirmedAbsent")) {
    throw new Error("bootstrapInactive requires bootstrapStackConfirmedAbsent=true; existing-stack upgrades must use active configuration");
  }
  const text = (key: string): string => {
    const value = context(key);
    if (value === undefined) return "";
    if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a nonempty string`);
    return value.trim();
  };
  const webCertificateArn = text("webCertificateArn");
  const webDomainName = text("webDomainName").toLowerCase();
  if (!/^arn:aws(?:-us-gov|-cn)?:acm:[a-z0-9-]+:\d{12}:certificate\/[a-f0-9-]{36}$/.test(webCertificateArn)) {
    throw new Error("webCertificateArn must be an approved ACM certificate ARN");
  }
  assertRegionalCertificate(webCertificateArn, environment);
  if (webDomainName.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(webDomainName)) {
    throw new Error("webDomainName must be the approved public DNS hostname without scheme, port or path");
  }
  const webOrigin = `https://${webDomainName}`;
  const configuredUpstream = text("mcpPointupUrl");
  let upstream: URL;
  try { upstream = new URL(configuredUpstream || webOrigin); }
  catch { throw new Error("mcpPointupUrl must be an approved HTTPS origin"); }
  if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== "/") {
    throw new Error("mcpPointupUrl must be an approved HTTPS origin without credentials, path, query or fragment");
  }
  return { bootstrapInactive, webCertificateArn, webDomainName, webOrigin, mcpPointupUrl: upstream.origin };
}
