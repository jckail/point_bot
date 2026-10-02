import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface GithubOidcStackProps extends cdk.StackProps {
  /** GitHub repository allowed to deploy, as "owner/name". */
  readonly githubRepo: string;
}

/**
 * One-time stack enabling keyless deploys from GitHub Actions via OIDC
 * federation - no long-lived AWS access keys in repository secrets.
 *
 *   npx cdk deploy GithubOidc -c githubRepo=owner/name
 *
 * Store the emitted role ARN as the AWS_DEPLOY_ROLE_ARN repository secret.
 * Note: an AWS account can hold only one OIDC provider per URL; if
 * token.actions.githubusercontent.com is already registered, import it
 * instead of deploying this stack twice.
 */
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, "GithubProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const expectedSubject = `repo:${props.githubRepo}:environment:production`;
    const oidcSubject: unknown = this.node.tryGetContext("githubOidcSubject") ?? expectedSubject;
    // New GitHub repositories can include immutable numeric IDs in subject names.
    const subjectSuffix = ":environment:production";
    if (typeof oidcSubject !== "string" || !oidcSubject.startsWith("repo:") || !oidcSubject.endsWith(subjectSuffix) || oidcSubject.includes("*") || oidcSubject.includes("?")) {
      throw new Error("githubOidcSubject must identify this repository's production environment exactly");
    }
    const subjectRepository = oidcSubject.slice(5, -subjectSuffix.length).split("/").map(part => part.replace(/@\d+$/, "")).join("/");
    if (subjectRepository !== props.githubRepo) throw new Error("githubOidcSubject does not match githubRepo");

    const role = new iam.Role(this, "DeployRole", {
      roleName: "pointup-github-deploy",
      description: `CDK deploys from GitHub Actions (${props.githubRepo})`,
      maxSessionDuration: cdk.Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            // The deploy job uses the protected production environment.
            "token.actions.githubusercontent.com:sub": oidcSubject,
          },
        },
      ),
    });

    // CDK deployments only need to assume the bootstrap roles; the heavy
    // permissions live on those roles, not on this one.
    const qualifier = this.node.tryGetContext("@aws-cdk/core:bootstrapQualifier") ?? "hnb659fds";
    if (typeof qualifier !== "string" || !/^[A-Za-z0-9_-]{1,10}$/.test(qualifier)) throw new Error("Invalid CDK bootstrap qualifier");
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-${qualifier}-*-role-${this.account}-${this.region}`],
      }),
    );

    // The stack-owned migration gate runs ECS tasks with narrowly scoped roles.
    // GitHub itself only assumes the CDK bootstrap deployment roles.

    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: role.roleArn,
      description: "Set as the AWS_DEPLOY_ROLE_ARN GitHub repository secret",
    });
  }
}
