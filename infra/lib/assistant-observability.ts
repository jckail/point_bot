import { Duration, Stack } from "aws-cdk-lib";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/** Low-cardinality operational metrics; request IDs remain searchable logs, never dimensions. */
export class AssistantObservability extends Construct {
  readonly dashboard: cw.Dashboard;
  constructor(scope: Construct, id: string, logGroup: logs.ILogGroup) {
    super(scope, id);
    const namespace = `${Stack.of(this).stackName}/PointUp/Assistant`;
    const period = Duration.minutes(5);
    const metric = (name: string, event: string, value = "1", unit = cw.Unit.COUNT, extra?: logs.JsonPattern) => {
      const patterns = [logs.FilterPattern.stringValue("$.component", "=", "pointup_assistant"), logs.FilterPattern.stringValue("$.event", "=", event)];
      if (value.startsWith("$.")) patterns.push(logs.FilterPattern.numberValue(value, ">=", 0));
      if (extra) patterns.push(extra);
      const filter = new logs.MetricFilter(this, name, { logGroup, filterPattern: logs.FilterPattern.all(...patterns), metricNamespace: namespace, metricName: name, metricValue: value, unit });
      return filter.metric({ period, statistic: "Sum" });
    };
    const started = metric("StartedRuns", "run_started");
    const completed = metric("CompletedRuns", "run_completed");
    const failed = metric("FailedRuns", "run_failed", "1", cw.Unit.COUNT, logs.FilterPattern.stringValue("$.status", "!=", "cancelled"));
    const cancelled = metric("CancelledRuns", "run_failed", "1", cw.Unit.COUNT, logs.FilterPattern.stringValue("$.status", "=", "cancelled"));
    const timedOut = metric("TimedOutRuns", "run_failed", "1", cw.Unit.COUNT, logs.FilterPattern.stringValue("$.status", "=", "timeout"));
    const turnStops = metric("MaxTurnStops", "run_failed", "1", cw.Unit.COUNT, logs.FilterPattern.stringValue("$.status", "=", "max_turns"));
    const latency = metric("CompletedRunLatency", "run_completed", "$.durationMs", cw.Unit.MILLISECONDS);
    const toolLatency = metric("ToolLatency", "tool_completed", "$.durationMs", cw.Unit.MILLISECONDS);
    const toolFailures = metric("FailedTools", "tool_completed", "1", cw.Unit.COUNT, logs.FilterPattern.stringValue("$.status", "=", "failed"));
    const inputTokens = metric("InputTokens", "run_usage", "$.inputTokenCount");
    const outputTokens = metric("OutputTokens", "run_usage", "$.outputTokenCount");
    const cachedInputTokens = metric("CachedInputTokens", "run_usage", "$.cachedInputTokenCount");
    const reasoningOutputTokens = metric("ReasoningOutputTokens", "run_usage", "$.reasoningOutputTokenCount");
    const modelRequests = metric("ModelRequests", "run_usage", "$.modelRequests");
    const failurePercent = new cw.MathExpression({ expression: "IF(r >= 10, 100 * FILL(f, 0) / r, 0)", usingMetrics: { r: started, f: failed }, period, label: "Failures % (10+ runs)" });
    new cw.Alarm(this, "FailureRate", { metric: failurePercent, threshold: 20, evaluationPeriods: 3, datapointsToAlarm: 2, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: cw.TreatMissingData.NOT_BREACHING, alarmDescription: "Assistant failures exceed 20% in at least two of three 5-minute periods with 10+ started runs; cancellations excluded" });
    new cw.Alarm(this, "Timeouts", { metric: timedOut, threshold: 5, evaluationPeriods: 2, datapointsToAlarm: 2, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: cw.TreatMissingData.NOT_BREACHING, alarmDescription: "Assistant has at least five timeouts in two consecutive 5-minute periods" });
    this.dashboard = new cw.Dashboard(this, "Dashboard", { defaultInterval: Duration.hours(6) });
    this.dashboard.addWidgets(
      new cw.GraphWidget({ title: "Assistant runs", width: 12, left: [started, completed, failed, cancelled] }),
      new cw.GraphWidget({ title: "Run outcomes", width: 12, left: [timedOut, turnStops, toolFailures], right: [failurePercent] }),
      new cw.GraphWidget({ title: "Completed run latency (ms)", width: 12, left: [latency.with({ statistic: "p50" }), latency.with({ statistic: "p95" })] }),
      new cw.GraphWidget({ title: "Tool latency (ms)", width: 12, left: [toolLatency.with({ statistic: "p50" }), toolLatency.with({ statistic: "p95" })] }),
      new cw.GraphWidget({ title: "Model token usage", width: 12, left: [inputTokens, outputTokens] }),
      new cw.GraphWidget({ title: "Reported cache and reasoning tokens", width: 12, left: [cachedInputTokens, reasoningOutputTokens] }),
      new cw.GraphWidget({ title: "Model requests", width: 12, left: [modelRequests] }),
      new cw.LogQueryWidget({ title: "Recent assistant failures: support reference", width: 24, logGroupNames: [logGroup.logGroupName], queryLines: ["fields @timestamp, requestId, traceId, sdkTraceId, mode, surface, status, httpStatus, turns, durationMs", 'filter (component = "pointup_assistant" and event = "run_failed") or (component = "pointup_assistant_http" and httpStatus >= 500)', "sort @timestamp desc", "limit 50"] }),
    );
  }
}
