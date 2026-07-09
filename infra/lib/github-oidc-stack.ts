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

    const role = new iam.Role(this, "DeployRole", {
      roleName: "pointup-github-deploy",
      description: `CDK deploys from GitHub Actions (${props.githubRepo})`,
      maxSessionDuration: cdk.Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            // Restrict to this repository; tighten to ":ref:refs/heads/master"
            // to exclude other branches and environments.
            "token.actions.githubusercontent.com:sub": `repo:${props.githubRepo}:*`,
          },
        },
      ),
    });

    // CDK deployments only need to assume the bootstrap roles; the heavy
    // permissions live on those roles, not on this one.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    // Post-deploy database migrations run as a one-off ECS task from CI.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "RunMigrationTask",
        actions: ["ecs:RunTask", "ecs:DescribeTasks"],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassTaskRoles",
        actions: ["iam:PassRole"],
        resources: [`arn:aws:iam::${this.account}:role/*`],
        conditions: {
          StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
        },
      }),
    );

    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: role.roleArn,
      description: "Set as the AWS_DEPLOY_ROLE_ARN GitHub repository secret",
    });
  }
}
