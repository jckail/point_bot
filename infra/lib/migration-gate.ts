import * as cdk from "aws-cdk-lib";
import * as cr from "aws-cdk-lib/custom-resources";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";

export interface MigrationGateProps {
  readonly cluster: ecs.Cluster;
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly securityGroup: ec2.SecurityGroup;
  readonly imageHash: string;
  readonly essentialContainerNames: readonly string[];
}

/** Complete a migration task before CloudFormation updates schema consumers. */
export class MigrationGate extends Construct {
  readonly resource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: MigrationGateProps) {
    super(scope, id);
    if (props.essentialContainerNames.length === 0)
      throw new Error("Migration gate requires an essential container");
    const code = lambda.Code.fromAsset(
      fileURLToPath(new URL("../lambda", import.meta.url)),
      {
        exclude: ["**/__pycache__", "**/*.pyc"],
      },
    );
    const onEvent = new lambda.Function(this, "OnEvent", {
      runtime: lambda.Runtime.PYTHON_3_13,
      code,
      handler: "migration_gate.on_event",
      timeout: cdk.Duration.seconds(60),
    });
    const isComplete = new lambda.Function(this, "IsComplete", {
      runtime: lambda.Runtime.PYTHON_3_13,
      code,
      handler: "migration_gate.is_complete",
      timeout: cdk.Duration.seconds(30),
    });
    onEvent.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [props.taskDefinition.taskDefinitionArn],
        conditions: { ArnEquals: { "ecs:cluster": props.cluster.clusterArn } },
      }),
    );
    onEvent.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [
          props.taskDefinition.taskRole.roleArn,
          props.taskDefinition.executionRole!.roleArn,
        ],
        conditions: {
          StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
        },
      }),
    );
    isComplete.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeTasks"],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: "ecs",
            resource: "task",
            resourceName: `${props.cluster.clusterName}/*`,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
        conditions: { ArnEquals: { "ecs:cluster": props.cluster.clusterArn } },
      }),
    );
    const provider = new cr.Provider(this, "Provider", {
      onEventHandler: onEvent,
      isCompleteHandler: isComplete,
      queryInterval: cdk.Duration.seconds(15),
      totalTimeout: cdk.Duration.minutes(30),
    });
    this.resource = new cdk.CustomResource(this, "Run", {
      serviceToken: provider.serviceToken,
      resourceType: "Custom::PointUpMigrationGate",
      properties: {
        ClusterArn: props.cluster.clusterArn,
        TaskDefinitionArn: props.taskDefinition.taskDefinitionArn,
        SubnetIds: props.cluster.vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }).subnetIds,
        SecurityGroupIds: [props.securityGroup.securityGroupId],
        EssentialContainerNames: [...props.essentialContainerNames],
        // New image contents rerun the gate even when no networking changes.
        ImageHash: props.imageHash,
        HandlerHash: cdk.FileSystem.fingerprint(code.path, {
          exclude: ["**/__pycache__", "**/*.pyc"],
        }),
      },
    });
    // Wait for routing, task-role policies and ingress before starting Fargate.
    this.resource.node.addDependency(
      props.cluster.vpc,
      props.taskDefinition,
      props.securityGroup,
    );
  }
}
