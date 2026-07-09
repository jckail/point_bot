import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── Networking ────────────────────────────────────────────────────────
    // One NAT gateway keeps costs down; bump to 2+ for production HA.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ─── Database ──────────────────────────────────────────────────────────
    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO,
      ),
      databaseName: "app",
      credentials: rds.Credentials.fromGeneratedSecret("app_admin"),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false, // enable for production HA
      backupRetention: cdk.Duration.days(7),
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });
    const dbSecret = database.secret!;

    // ─── Application secrets ───────────────────────────────────────────────
    // A placeholder value is generated on first deploy; set the real Clerk
    // secret key afterwards:
    //   aws secretsmanager put-secret-value \
    //     --secret-id <arn> --secret-string 'sk_live_...'
    const clerkSecret = new secretsmanager.Secret(this, "ClerkSecret", {
      description: "Clerk secret key (set the real sk_... value after deploy)",
      generateSecretString: {
        passwordLength: 40,
        excludePunctuation: true,
      },
    });

    // ─── Container image ───────────────────────────────────────────────────
    // Built from the repo root Dockerfile at deploy time and pushed to the
    // CDK-managed ECR repository.
    //
    // The Clerk publishable key is public by design but must be inlined into
    // the client bundle at build time. Provide it via CDK context:
    //   npx cdk deploy -c clerkPublishableKey=pk_live_...
    // or the CLERK_PUBLISHABLE_KEY environment variable.
    const clerkPublishableKey: string | undefined =
      (this.node.tryGetContext("clerkPublishableKey") as string | undefined) ??
      process.env.CLERK_PUBLISHABLE_KEY;

    // PointUp Assistant on Bedrock. Provide a verified in-account Sonnet model
    // or inference-profile id to enable it; otherwise the app falls back to the
    // heuristic assistant. Set via context or the BEDROCK_MODEL_ID env var:
    //   npx cdk deploy -c bedrockModelId=global.anthropic.claude-sonnet-4-5-20250929-v1:0
    const bedrockModelId: string | undefined =
      (this.node.tryGetContext("bedrockModelId") as string | undefined) ??
      process.env.BEDROCK_MODEL_ID;
    if (!clerkPublishableKey) {
      cdk.Annotations.of(this).addWarning(
        "No Clerk publishable key provided (context 'clerkPublishableKey' or env CLERK_PUBLISHABLE_KEY); building with a placeholder that will not work in production.",
      );
    }

    const image = new ecrAssets.DockerImageAsset(this, "AppImage", {
      directory: path.join(__dirname, "..", ".."),
      platform: ecrAssets.Platform.LINUX_AMD64,
      exclude: ["infra", "docs", ".git", "**/node_modules", "**/.next"],
      buildArgs: {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
          clerkPublishableKey ??
          "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
      },
    });

    // ─── ECS Fargate service behind an ALB ─────────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "Service",
      {
        cluster,
        cpu: 512,
        memoryLimitMiB: 1024,
        desiredCount: 2,
        minHealthyPercent: 100,
        publicLoadBalancer: true,
        // For HTTPS: add a certificate + domainName/domainZone here and the
        // pattern will provision the 443 listener and Route 53 record.
        taskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(image),
          containerPort: 3000,
          environment: {
            NODE_ENV: "production",
            // src/env.ts composes DATABASE_URL from the DB_* variables below.
            // Enable the Bedrock-backed assistant when a model id is supplied.
            ...(bedrockModelId
              ? { LLM_PROVIDER: "bedrock", BEDROCK_MODEL_ID: bedrockModelId }
              : {}),
          },
          secrets: {
            DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
            DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
            DB_USER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
            DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
            DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, "dbname"),
            CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(clerkSecret),
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "app",
            logRetention: logs.RetentionDays.ONE_MONTH,
          }),
        },
        circuitBreaker: { rollback: true },
      },
    );

    service.targetGroup.configureHealthCheck({
      path: "/api/health",
      healthyThresholdCount: 2,
      interval: cdk.Duration.seconds(15),
    });

    const scaling = service.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 6,
    });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 60,
    });

    database.connections.allowDefaultPortFrom(
      service.service,
      "App tasks to PostgreSQL",
    );

    // Allow the web task to invoke Claude on Bedrock (Converse API). Scoped to
    // foundation-model and inference-profile ARNs in this account/region. Only
    // attached when a Bedrock model id is configured.
    if (bedrockModelId) {
      service.taskDefinition.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream",
          ],
          resources: [
            `arn:aws:bedrock:${this.region}::foundation-model/*`,
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
            // Inference profiles can route to models in other regions; grant
            // the underlying cross-region foundation models too.
            "arn:aws:bedrock:*::foundation-model/*",
          ],
        }),
      );
    }

    // ─── Background worker (scheduled jobs) ────────────────────────────────
    // One image, two EventBridge schedules: balance syncs every 6 hours and a
    // weekly email digest via SES. The digest sender address must be a
    // verified SES identity; provide it via context or DIGEST_FROM_EMAIL:
    //   npx cdk deploy -c digestFromEmail=digest@yourdomain.com
    const workerImage = new ecrAssets.DockerImageAsset(this, "WorkerImage", {
      directory: path.join(__dirname, "..", ".."),
      file: "Dockerfile.worker",
      platform: ecrAssets.Platform.LINUX_AMD64,
      exclude: ["infra", "docs", ".git", "**/node_modules", "**/.next"],
    });

    const digestFromEmail: string | undefined =
      (this.node.tryGetContext("digestFromEmail") as string | undefined) ??
      process.env.DIGEST_FROM_EMAIL;

    const workerSecrets = {
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
      DB_USER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
      DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, "dbname"),
      CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(clerkSecret),
    };

    const syncTask = new ecsPatterns.ScheduledFargateTask(this, "SyncTask", {
      cluster,
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      scheduledFargateTaskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(workerImage),
        command: ["sync"],
        cpu: 256,
        memoryLimitMiB: 512,
        environment: { NODE_ENV: "production" },
        secrets: workerSecrets,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: "worker-sync",
          logRetention: logs.RetentionDays.ONE_MONTH,
        }),
      },
    });

    const digestTask = new ecsPatterns.ScheduledFargateTask(
      this,
      "DigestTask",
      {
        cluster,
        // Monday 13:00 UTC - morning across US time zones.
        schedule: events.Schedule.cron({
          weekDay: "MON",
          hour: "13",
          minute: "0",
        }),
        subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        scheduledFargateTaskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(workerImage),
          command: ["digest"],
          cpu: 256,
          memoryLimitMiB: 512,
          environment: {
            NODE_ENV: "production",
            MAILER: digestFromEmail ? "ses" : "console",
            ...(digestFromEmail ? { DIGEST_FROM_EMAIL: digestFromEmail } : {}),
          },
          secrets: workerSecrets,
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "worker-digest",
            logRetention: logs.RetentionDays.ONE_MONTH,
          }),
        },
      },
    );

    digestTask.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    for (const task of [syncTask, digestTask]) {
      database.connections.allowDefaultPortFrom(
        task.task.securityGroups![0]!,
        "Worker tasks to PostgreSQL",
      );
    }

    // ─── One-off migration task (invoked by CI after each deploy) ──────────
    // Same worker image, `migrate` command: applies pending drizzle
    // migrations under an advisory lock. CI runs it via `aws ecs run-task`
    // using the outputs below.
    const migrationTaskDef = new ecs.FargateTaskDefinition(
      this,
      "MigrationTaskDef",
      { cpu: 256, memoryLimitMiB: 512 },
    );
    migrationTaskDef.addContainer("Migrate", {
      image: ecs.ContainerImage.fromDockerImageAsset(workerImage),
      command: ["migrate"],
      environment: { NODE_ENV: "production" },
      secrets: workerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "migrate",
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
    });

    const migrationSecurityGroup = new ec2.SecurityGroup(
      this,
      "MigrationSecurityGroup",
      { vpc, description: "One-off migration tasks", allowAllOutbound: true },
    );
    database.connections.allowDefaultPortFrom(
      migrationSecurityGroup,
      "Migration task to PostgreSQL",
    );

    // ─── Monitoring ────────────────────────────────────────────────────────
    new cloudwatch.Alarm(this, "Alb5xxAlarm", {
      alarmDescription: "ALB is returning 5xx responses",
      metric: service.loadBalancer.metrics.httpCodeElb(
        cdk.aws_elasticloadbalancingv2.HttpCodeElb.ELB_5XX_COUNT,
        { period: cdk.Duration.minutes(5), statistic: "Sum" },
      ),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, "ServiceCpuAlarm", {
      alarmDescription: "App service CPU is sustained above 85%",
      metric: service.service.metricCpuUtilization({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 85,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ─── Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "LoadBalancerUrl", {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description: "Public URL of the application",
    });
    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: dbSecret.secretArn,
      description: "Secrets Manager ARN for the RDS credentials",
    });
    new cdk.CfnOutput(this, "ClerkSecretArn", {
      value: clerkSecret.secretArn,
      description: "Set the real Clerk secret key (sk_...) in this secret",
    });

    // Consumed by .github/workflows/deploy.yml to run migrations post-deploy.
    new cdk.CfnOutput(this, "ClusterArn", { value: cluster.clusterArn });
    new cdk.CfnOutput(this, "MigrationTaskDefinitionArn", {
      value: migrationTaskDef.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, "MigrationSubnetIds", {
      value: vpc
        .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
        .subnetIds.join(","),
    });
    new cdk.CfnOutput(this, "MigrationSecurityGroupId", {
      value: migrationSecurityGroup.securityGroupId,
    });
  }
}
