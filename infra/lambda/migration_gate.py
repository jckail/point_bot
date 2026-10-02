"""CDK async-provider handlers. AWS clients are created only for active events."""
import hashlib


def _ecs():
    import boto3
    return boto3.client("ecs")


def _identity(event):
    value = f"{event['StackId']}:{event['LogicalResourceId']}"
    return "pointup-migration-" + hashlib.sha256(value.encode()).hexdigest()[:32]


def on_event(event, context):
    physical_id = event.get("PhysicalResourceId") or _identity(event)
    if event["RequestType"] == "Delete":
        return {"PhysicalResourceId": physical_id}
    if event["RequestType"] not in ("Create", "Update"):
        raise ValueError("Unsupported migration gate request")
    props = event["ResourceProperties"]
    # CloudFormation retries retain RequestId. A later update gets its own token,
    # even when rolling back to an earlier image, without replacing the resource.
    token_input = f"{event['StackId']}:{event['LogicalResourceId']}:{event['RequestId']}"
    token = hashlib.sha256(token_input.encode()).hexdigest()
    result = _ecs().run_task(
        cluster=props["ClusterArn"],
        taskDefinition=props["TaskDefinitionArn"],
        launchType="FARGATE",
        count=1,
        clientToken=token,
        startedBy="pointup-" + token[:28],
        networkConfiguration={"awsvpcConfiguration": {
            "subnets": props["SubnetIds"],
            "securityGroups": props["SecurityGroupIds"],
            "assignPublicIp": "DISABLED",
        }},
    )
    tasks = result.get("tasks", [])
    if result.get("failures") or len(tasks) != 1 or not tasks[0].get("taskArn"):
        raise RuntimeError("ECS did not start exactly one migration task")
    return {"PhysicalResourceId": physical_id, "Data": {"TaskArn": tasks[0]["taskArn"]}}


def is_complete(event, context):
    if event["RequestType"] == "Delete":
        return {"IsComplete": True}
    props = event["ResourceProperties"]
    task_arn = event["Data"]["TaskArn"]
    result = _ecs().describe_tasks(cluster=props["ClusterArn"], tasks=[task_arn])
    tasks = result.get("tasks", [])
    if result.get("failures") or len(tasks) != 1 or tasks[0].get("taskArn") != task_arn:
        raise RuntimeError("Migration task is missing or could not be described")
    task = tasks[0]
    if task.get("lastStatus") != "STOPPED":
        return {"IsComplete": False}
    essential = props["EssentialContainerNames"]
    if not essential:
        raise RuntimeError("Migration task has no expected essential containers")
    containers = {container.get("name"): container for container in task.get("containers", [])}
    for name in essential:
        container = containers.get(name)
        exit_code = container.get("exitCode") if container else None
        if type(exit_code) is not int or exit_code != 0:
            raise RuntimeError(f"Migration container {name} failed or has no exit code")
    return {"IsComplete": True}
