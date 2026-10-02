import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("migration_gate", Path(__file__).parent.parent / "lambda/migration_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

TASK = "arn:aws:ecs:us-east-1:123456789012:task/pointup/task-id"


def event(kind="Create", **extra):
    return {
        "RequestType": kind, "StackId": "stack-id", "LogicalResourceId": "Gate",
        "RequestId": "request-id", "ResourceProperties": {
            "ClusterArn": "cluster-arn", "TaskDefinitionArn": "task-def-arn",
            "SubnetIds": ["private-a", "private-b"], "SecurityGroupIds": ["migration-sg"],
            "EssentialContainerNames": ["Migrate"], "ImageHash": "image-hash",
        }, **extra,
    }


class MigrationGateLifecycle(unittest.TestCase):
    def setUp(self):
        self.ecs = Mock()
        self.ecs.run_task.return_value = {"tasks": [{"taskArn": TASK}], "failures": []}
        self.ecs.describe_tasks.return_value = {"tasks": [{
            "taskArn": TASK, "lastStatus": "STOPPED",
            "containers": [{"name": "Migrate", "exitCode": 0}],
        }]}
        self.patch = patch.object(gate, "_ecs", return_value=self.ecs)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def complete(self, **extra):
        return gate.is_complete(event(Data={"TaskArn": TASK}, **extra), None)

    def test_create_starts_exact_private_migration_definition(self):
        receipt = gate.on_event(event(), None)
        self.assertEqual(receipt["Data"], {"TaskArn": TASK})
        args = self.ecs.run_task.call_args.kwargs
        self.assertEqual(args["cluster"], "cluster-arn")
        self.assertEqual(args["taskDefinition"], "task-def-arn")
        self.assertEqual(args["launchType"], "FARGATE")
        self.assertEqual(args["count"], 1)
        self.assertEqual(args["networkConfiguration"]["awsvpcConfiguration"], {
            "subnets": ["private-a", "private-b"], "securityGroups": ["migration-sg"], "assignPublicIp": "DISABLED",
        })
        self.assertEqual(len(args["clientToken"]), 64)
        self.assertLessEqual(len(args["startedBy"]), 36)

    def test_replayed_request_uses_identical_ecs_idempotency_arguments(self):
        first = gate.on_event(event(), None)
        first_call = self.ecs.run_task.call_args
        # Simulate delivery retry after ECS accepted the first launch.
        second = gate.on_event(event(), None)
        self.assertEqual(self.ecs.run_task.call_args, first_call)
        self.assertEqual(first, second)

    def test_update_keeps_physical_identity_but_gets_new_launch_token(self):
        first = gate.on_event(event(), None)
        create_token = self.ecs.run_task.call_args.kwargs["clientToken"]
        updated = gate.on_event(event("Update", RequestId="update-request", PhysicalResourceId=first["PhysicalResourceId"]), None)
        self.assertEqual(updated["PhysicalResourceId"], first["PhysicalResourceId"])
        self.assertNotEqual(self.ecs.run_task.call_args.kwargs["clientToken"], create_token)

    def test_delete_never_starts_or_polls_aws(self):
        deleting = event("Delete", PhysicalResourceId="existing-gate")
        self.assertEqual(gate.on_event(deleting, None), {"PhysicalResourceId": "existing-gate"})
        self.assertEqual(gate.is_complete(deleting, None), {"IsComplete": True})
        gate._ecs.assert_not_called()

    def test_launch_failure_empty_receipt_and_multiple_tasks_fail_closed(self):
        for result in [{"failures": [{"reason": "capacity"}]}, {"tasks": []},
                       {"tasks": [{}]}, {"tasks": [{"taskArn": TASK}, {"taskArn": "second"}]}]:
            with self.subTest(result=result):
                self.ecs.run_task.return_value = result
                with self.assertRaisesRegex(RuntimeError, "did not start"):
                    gate.on_event(event(), None)

    def test_running_task_keeps_consumers_blocked(self):
        self.ecs.describe_tasks.return_value["tasks"][0]["lastStatus"] = "RUNNING"
        self.assertEqual(self.complete(), {"IsComplete": False})
        self.ecs.describe_tasks.assert_called_once_with(cluster="cluster-arn", tasks=[TASK])

    def test_stopped_task_all_essential_zero_succeeds(self):
        self.assertEqual(self.complete(), {"IsComplete": True})

    def test_missing_or_wrong_task_fails_closed(self):
        for result in [{"tasks": []}, {"failures": [{"reason": "MISSING"}]},
                       {"tasks": [{"taskArn": "wrong", "lastStatus": "STOPPED"}]}]:
            with self.subTest(result=result):
                self.ecs.describe_tasks.return_value = result
                with self.assertRaisesRegex(RuntimeError, "missing"):
                    self.complete()

    def test_nonzero_missing_or_invalid_exit_code_fails_closed(self):
        for code in [1, 137, None, "0", False]:
            with self.subTest(code=code):
                self.ecs.describe_tasks.return_value["tasks"][0]["containers"][0]["exitCode"] = code
                with self.assertRaisesRegex(RuntimeError, "failed or has no exit"):
                    self.complete()

    def test_missing_essential_container_and_failed_second_essential_fail(self):
        self.ecs.describe_tasks.return_value["tasks"][0]["containers"] = []
        with self.assertRaises(RuntimeError):
            self.complete()
        self.ecs.describe_tasks.return_value["tasks"][0]["containers"] = [
            {"name": "Migrate", "exitCode": 0}, {"name": "Second", "exitCode": 1},
        ]
        props = event()["ResourceProperties"]
        props["EssentialContainerNames"].append("Second")
        with self.assertRaises(RuntimeError):
            self.complete(ResourceProperties=props)

    def test_ecs_api_errors_fail_stack_instead_of_releasing_gate(self):
        self.ecs.describe_tasks.side_effect = RuntimeError("AccessDenied")
        with self.assertRaisesRegex(RuntimeError, "AccessDenied"):
            self.complete()


if __name__ == "__main__":
    unittest.main()
