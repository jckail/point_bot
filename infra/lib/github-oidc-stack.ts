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
 *   npx cdk deploy GithubOidc -c deploymentMode=oidc -c githubRepo=owner/name
 *
 * Store the emitted role ARN as the AWS_DEPLOY_ROLE_ARN repository secret.
 * Note: an AWS account can hold only one OIDC provider per URL; if
 * token.actions.githubusercontent.com is already registered, import it
 * instead of deploying this stack twice.
 */
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(props.githubRepo)) {
      throw new Error("githubRepo must be an exact owner/repository without wildcards");
    }

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
            // The deployment job uses the protected production environment.
            "token.actions.githubusercontent.com:sub": `repo:${props.githubRepo}:environment:production`,
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
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-*`],
      }),
    );

    const arn = (service: string, resource: string) =>
      `arn:${this.partition}:${service}:${this.region}:${this.account}:${resource}`;
    // Read-only discovery precedes any mutation. ListStacks and EC2 Describe
    // have no resource-level restriction; they do not expose secret values.
    role.addToPolicy(new iam.PolicyStatement({
      sid: "DiscoverDeploymentResources",
      actions: ["cloudformation:ListStacks", "ec2:DescribeSubnets", "ec2:DescribeSecurityGroups"],
      resources: ["*"],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectPointUpDeployment",
      actions: ["cloudformation:DescribeStacks", "cloudformation:GetTemplate", "cloudformation:ListStackResources"],
      resources: [arn("cloudformation", "stack/TemplateApp/*")],
    }));
    // A prepared bootstrap may execute only its exact CREATE-only change set.
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectBootstrapChangeSet",
      actions: ["cloudformation:DescribeChangeSet"],
      resources: [arn("cloudformation", "stack/TemplateApp/*"), arn("cloudformation", "changeSet/pointup-bootstrap-*/*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "ExecuteBootstrapChangeSet",
      actions: ["cloudformation:ExecuteChangeSet"],
      resources: [arn("cloudformation", "stack/TemplateApp/*"), arn("cloudformation", "changeSet/pointup-bootstrap-*/*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectCandidateAssets",
      actions: ["ecr:DescribeImages", "ecr:DescribeRepositories"],
      resources: [arn("ecr", `repository/cdk-*-container-assets-${this.account}-${this.region}`)],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectMigrationTask",
      actions: ["ecs:DescribeTaskDefinition"],
      resources: [arn("ecs", "task-definition/TemplateApp*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectMigrationCluster",
      actions: ["ecs:DescribeClusters"],
      resources: [arn("ecs", "cluster/TemplateApp-*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectDatabaseSecretMetadata",
      actions: ["secretsmanager:DescribeSecret"],
      resources: [arn("secretsmanager", "secret:TemplateApp*"), arn("secretsmanager", "secret:rds!db-*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectApprovedDatabaseBackup",
      actions: ["rds:DescribeDBInstances"],
      resources: [arn("rds", "db:templateapp-*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "InspectApprovedSnapshot",
      actions: ["rds:DescribeDBSnapshots"],
      resources: [arn("rds", "snapshot:*")],
    }));
    // RegisterTaskDefinition cannot be resource-scoped; require our explicit
    // purpose tags. PassRole below still limits the execution/task roles.
    role.addToPolicy(new iam.PolicyStatement({
      sid: "RegisterCandidateMigration",
      actions: ["ecs:RegisterTaskDefinition"],
      resources: ["*"],
      conditions: { StringEquals: { "aws:RequestTag/pointup:stack": "TemplateApp", "aws:RequestTag/pointup:purpose": "migration" } },
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "TagCandidateMigration",
      actions: ["ecs:TagResource"],
      resources: [arn("ecs", "task-definition/TemplateApp*")],
      conditions: { StringEquals: { "aws:RequestTag/pointup:stack": "TemplateApp", "aws:RequestTag/pointup:purpose": "migration" } },
    }));
    // Candidate migration must complete before activating hosts or schedules.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "RunMigrationTask",
        actions: ["ecs:RunTask"],
        resources: [arn("ecs", "task-definition/TemplateApp*")],
        conditions: { ArnLike: { "ecs:cluster": arn("ecs", "cluster/TemplateApp-*") } },
      }),
    );
    role.addToPolicy(new iam.PolicyStatement({
      sid: "ObserveAndStopMigration",
      actions: ["ecs:DescribeTasks", "ecs:StopTask"],
      resources: [arn("ecs", "task/TemplateApp-*/*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "ReadMigrationAttestation",
      actions: ["logs:GetLogEvents"],
      resources: [arn("logs", "log-group:TemplateApp-*:*"), arn("logs", "log-group:/ecs/TemplateApp*:*" )],
    }));
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassTaskRoles",
        actions: ["iam:PassRole"],
        resources: [`arn:${this.partition}:iam::${this.account}:role/TemplateApp-*`],
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
