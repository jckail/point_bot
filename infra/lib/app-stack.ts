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
    //   npx cdk deploy -c bedrockModelId=anthropic.claude-sonnet-5
    const bedrockModelId: string | undefined =
      (this.node.tryGetContext("bedrockModelId") as string | undefined) ??
      process.env.BEDROCK_MODEL_ID;
    if (!clerkPublishableKey) {
      cdk.Annotations.of(this).addWarning(
        "No Clerk publishable key provided (context 'clerkPublishableKey' or env CLERK_PUBLISHABLE_KEY); building with a placeholder that will not work in production.",
      );
    }

    // ─── Optional assistant / scraping config ──────────────────────────────
    // Non-secret config comes from CDK context; API keys become Secrets
    // Manager placeholders (set the real value after deploy), created only when
    // opted in so we never provision empty secrets:
    //   -c enableOpenAiLlm=true  -c llmModel=gpt-4o-mini  -c llmBaseUrl=...
    //   -c enableFirecrawl=true  -c firecrawlBaseUrl=https://api.firecrawl.dev
    const ctx = (key: string): string | undefined =>
      (this.node.tryGetContext(key) as string | undefined) || undefined;
    const placeholderSecret = (id: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        description,
        generateSecretString: { passwordLength: 40, excludePunctuation: true },
      });

    const openAiLlmSecret = this.node.tryGetContext("enableOpenAiLlm")
      ? placeholderSecret(
          "OpenAiLlmApiKey",
          "OpenAI-compatible LLM API key (set the real value after deploy)",
        )
      : undefined;
    const firecrawlSecret = this.node.tryGetContext("enableFirecrawl")
      ? placeholderSecret(
          "FirecrawlApiKey",
          "Firecrawl API key (set the real fc-... value after deploy)",
        )
      : undefined;

    // Bedrock wins when configured; otherwise fall back to the OpenAI provider
    // when its secret is present. Non-secret knobs are plain env.
    const assistantEnvironment: Record<string, string> = {
      ...(bedrockModelId
        ? { LLM_PROVIDER: "bedrock", BEDROCK_MODEL_ID: bedrockModelId }
        : openAiLlmSecret
          ? { LLM_PROVIDER: "openai" }
          : {}),
      ...(ctx("llmModel") ? { LLM_MODEL: ctx("llmModel")! } : {}),
      ...(ctx("llmBaseUrl") ? { LLM_BASE_URL: ctx("llmBaseUrl")! } : {}),
      ...(ctx("firecrawlBaseUrl")
        ? { FIRECRAWL_BASE_URL: ctx("firecrawlBaseUrl")! }
        : {}),
    };
    const assistantSecrets: Record<string, ecs.Secret> = {
      ...(openAiLlmSecret
        ? { LLM_API_KEY: ecs.Secret.fromSecretsManager(openAiLlmSecret) }
        : {}),
      ...(firecrawlSecret
        ? { FIRECRAWL_API_KEY: ecs.Secret.fromSecretsManager(firecrawlSecret) }
        : {}),
    };

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
            // Assistant (Bedrock/OpenAI) + Firecrawl config, when configured.
            ...assistantEnvironment,
          },
          secrets: {
            DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
            DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
            DB_USER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
            DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
            DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, "dbname"),
            CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(clerkSecret),
            ...assistantSecrets,
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

    // Grant a task role permission to invoke Claude on Bedrock (Converse API),
    // scoped to foundation-model + inference-profile ARNs. Reused by the web
    // service and the optional bot service.
    const grantBedrockInvoke = (role: iam.IRole) =>
      role.addToPrincipalPolicy(
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

    // Only attached when a Bedrock model id is configured.
    if (bedrockModelId) {
      grantBedrockInvoke(service.taskDefinition.taskRole);
    }

    // ─── PointBot chat surface (optional) ──────────────────────────────────
    // A public HTTP(S) service handling Slack/Discord commands. Opt in with
    // `-c enableBot=true`. Slack/Discord require HTTPS, so provide an ACM cert
    // + domain for a production-usable endpoint:
    //   npx cdk deploy -c enableBot=true \
    //     -c botCertificateArn=arn:aws:acm:...:certificate/... \
    //     -c botDomainName=bot.example.com \
    //     -c botDefaultUserId=user_123        # self-hosted single-user mode
    //     -c discordPublicKey=<hex> -c discordAppId=<id>
    // The Slack signing secret is a Secrets Manager placeholder set after deploy.
    if (this.node.tryGetContext("enableBot")) {
      const botImage = new ecrAssets.DockerImageAsset(this, "BotImage", {
        directory: path.join(__dirname, "..", ".."),
        file: "Dockerfile.bot",
        platform: ecrAssets.Platform.LINUX_AMD64,
        exclude: ["infra", "docs", ".git", "**/node_modules", "**/.next"],
      });

      const slackSigningSecret = placeholderSecret(
        "SlackSigningSecret",
        "Slack signing secret for the bot (set the real value after deploy)",
      );

      const botCertificateArn = ctx("botCertificateArn");
      const botDomainName = ctx("botDomainName");

      const botService = new ecsPatterns.ApplicationLoadBalancedFargateService(
        this,
        "BotService",
        {
          cluster,
          cpu: 256,
          memoryLimitMiB: 512,
          desiredCount: 1,
          minHealthyPercent: 100,
          publicLoadBalancer: true,
          ...(botCertificateArn && botDomainName
            ? {
                certificate: cdk.aws_certificatemanager.Certificate.fromCertificateArn(
                  this,
                  "BotCertificate",
                  botCertificateArn,
                ),
                domainName: botDomainName,
                redirectHTTP: true,
              }
            : {}),
          taskImageOptions: {
            image: ecs.ContainerImage.fromDockerImageAsset(botImage),
            containerPort: 8080,
            environment: {
              NODE_ENV: "production",
              PORT: "8080",
              ...assistantEnvironment,
              ...(ctx("botDefaultUserId")
                ? { BOT_DEFAULT_USER_ID: ctx("botDefaultUserId")! }
                : {}),
              ...(ctx("discordPublicKey")
                ? { DISCORD_PUBLIC_KEY: ctx("discordPublicKey")! }
                : {}),
              ...(ctx("discordAppId")
                ? { DISCORD_APP_ID: ctx("discordAppId")! }
                : {}),
            },
            secrets: {
              DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
              DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
              DB_USER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
              DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
              DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, "dbname"),
              SLACK_SIGNING_SECRET:
                ecs.Secret.fromSecretsManager(slackSigningSecret),
              ...assistantSecrets,
            },
            logDriver: ecs.LogDrivers.awsLogs({
              streamPrefix: "bot",
              logRetention: logs.RetentionDays.ONE_MONTH,
            }),
          },
          circuitBreaker: { rollback: true },
        },
      );

      botService.targetGroup.configureHealthCheck({
        path: "/health",
        healthyThresholdCount: 2,
        interval: cdk.Duration.seconds(15),
      });
      database.connections.allowDefaultPortFrom(
        botService.service,
        "Bot tasks to PostgreSQL",
      );
      if (bedrockModelId) {
        grantBedrockInvoke(botService.taskDefinition.taskRole);
      }

      new cdk.CfnOutput(this, "BotUrl", {
        value: botDomainName
          ? `https://${botDomainName}`
          : `http://${botService.loadBalancer.loadBalancerDnsName}`,
        description:
          "PointBot endpoint. Slack: <url>/slack/commands, Discord: <url>/discord/interactions",
      });
      new cdk.CfnOutput(this, "BotSlackSigningSecretArn", {
        value: slackSigningSecret.secretArn,
        description: "Set the real Slack signing secret in this secret",
      });
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
            // Optional chat digests. Webhook URLs carry a token — pass via
            // context, or move to Secrets Manager for stricter setups:
            //   -c slackWebhookUrl=https://hooks.slack.com/services/...
            //   -c discordWebhookUrl=https://discord.com/api/webhooks/...
            ...(ctx("slackWebhookUrl")
              ? { SLACK_WEBHOOK_URL: ctx("slackWebhookUrl")! }
              : {}),
            ...(ctx("discordWebhookUrl")
              ? { DISCORD_WEBHOOK_URL: ctx("discordWebhookUrl")! }
              : {}),
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

    // ─── Proactive alerts task (daily) ─────────────────────────────────────
    // Fires only when a user has something worth flagging (expiring points,
    // reached goals, large balance moves); delivers via chat + email.
    const chatWebhookEnv: Record<string, string> = {
      ...(ctx("slackWebhookUrl")
        ? { SLACK_WEBHOOK_URL: ctx("slackWebhookUrl")! }
        : {}),
      ...(ctx("discordWebhookUrl")
        ? { DISCORD_WEBHOOK_URL: ctx("discordWebhookUrl")! }
        : {}),
    };
    const alertsTask = new ecsPatterns.ScheduledFargateTask(this, "AlertsTask", {
      cluster,
      // Daily at 12:00 UTC.
      schedule: events.Schedule.cron({ hour: "12", minute: "0" }),
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      scheduledFargateTaskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(workerImage),
        command: ["alerts"],
        cpu: 256,
        memoryLimitMiB: 512,
        environment: {
          NODE_ENV: "production",
          MAILER: digestFromEmail ? "ses" : "console",
          ...(digestFromEmail ? { DIGEST_FROM_EMAIL: digestFromEmail } : {}),
          ...chatWebhookEnv,
        },
        secrets: workerSecrets,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: "worker-alerts",
          logRetention: logs.RetentionDays.ONE_MONTH,
        }),
      },
    });
    alertsTask.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    for (const task of [syncTask, digestTask, alertsTask]) {
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
    if (openAiLlmSecret) {
      new cdk.CfnOutput(this, "OpenAiLlmSecretArn", {
        value: openAiLlmSecret.secretArn,
        description: "Set the real OpenAI-compatible LLM API key in this secret",
      });
    }
    if (firecrawlSecret) {
      new cdk.CfnOutput(this, "FirecrawlSecretArn", {
        value: firecrawlSecret.secretArn,
        description: "Set the real Firecrawl API key (fc-...) in this secret",
      });
    }

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
