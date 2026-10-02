import * as cdk from "aws-cdk-lib";

import { AppStack } from "../lib/app-stack.js";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";
import { deploymentMode } from "../lib/rollout-config.js";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Public hosts require webCertificateArn + webDomainName. Deployment tooling may
// set bootstrapInactive=true and bootstrapStackConfirmedAbsent=true only after
// confirming TemplateApp does not exist; upgrades always use active configuration.
const mode = deploymentMode(key => app.node.tryGetContext(key));
if (mode === "application") {
  new AppStack(app, "TemplateApp", {
    env,
    description: "Next.js app on ECS Fargate with RDS PostgreSQL",
  });
}

// One-time stack for keyless GitHub Actions deploys:
//   npx cdk deploy GithubOidc -c deploymentMode=oidc -c githubRepo=owner/name
const githubRepo = app.node.tryGetContext("githubRepo") as string | undefined;
if (githubRepo) {
  new GithubOidcStack(app, "GithubOidc", {
    env,
    githubRepo,
    description: "GitHub Actions OIDC provider and deploy role",
  });
}
