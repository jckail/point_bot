import { generateTraceId } from "@openai/agents";
import { getRequestContext, REQUEST_ID_HEADER } from "@pointup/core";
import { chatAssistantRequestSchema } from "@pointup/core/contracts";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";
import { readJsonBody } from "@/server/request-body";
import { webObservability } from "@/server/observability";
import { mayWritePortfolio } from "@/server/access-policy";
import { assistantConfig } from "@/server/assistant-agent/config";
import { isSdkTracingEnabled } from "@/server/assistant-agent/private-tracing";
import { getAssistantActions } from "@/server/assistant-agent/actions";
import { runPortfolioAssistant } from "@/server/assistant-agent";
import { assistantAdmission } from "@/server/assistant-agent/admission";

/** SDK and existing provider fallback share PR14's authentication and telemetry. */
export async function POST(request: Request) {
  const startedAt = performance.now();
  const sourceHeader = request.headers.get("X-PointUp-Surface");
  const source = sourceHeader === "extension" || sourceHeader === "web" ? sourceHeader : "api";
  let mode = "fallback";
  let traceId: string | undefined;
  const response = await withAuthenticatedUser(async (userId, principal) => {
    const body = chatAssistantRequestSchema.parse(await readJsonBody(request, false, 32 * 1024));
    const lease = assistantAdmission.acquire(userId);
    if ("retryAfter" in lease) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Assistant request limit reached. Try again shortly." } },
      { status: 429, headers: { "Retry-After": String(lease.retryAfter), "Cache-Control": "private, no-store" } },
    );
    try {
      const configured = assistantConfig(env);
      // Chrome MV3 can stop a worker after fetch waits 30s; leave response margin.
      const config = { ...configured,
        tracing: configured.runtime === "agents" && configured.tracing && isSdkTracingEnabled(),
        timeoutMs: source === "extension" ? Math.min(configured.timeoutMs, 20_000) : configured.timeoutMs,
      };
      mode = config.runtime === "agents" ? "agents" : "fallback";
      // Correlation supplied by the caller must never determine an SDK trace ID.
      if (mode === "agents" && config.tracing) traceId = generateTraceId();
      const actions = mode === "agents" && mayWritePortfolio(principal) ? getAssistantActions() : undefined;
      const result = await runPortfolioAssistant({ actions, userId, body, useCases: getContainer().useCases,
        config, requestId: getRequestContext()?.requestId, traceId, source, signal: request.signal });
      traceId = result.traceId;
      return NextResponse.json({ reply: result.reply, ...(result.actions ? { actions: result.actions } : {}) });
    } finally { lease.release(); }
  }, { method: "POST", scope: "portfolio:read" });
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  if (requestId) response.headers.set("X-PointUp-Request-Id", requestId);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-PointUp-Assistant-Mode", mode);
  if (traceId) response.headers.set("X-PointUp-Trace-Id", traceId);
  try {
    webObservability().logger.info("assistant_http", { component: "pointup_assistant_http",
      event: response.ok ? "request_completed" : "request_failed", ...(requestId ? { requestId } : {}),
      surface: source, httpStatus: response.status, durationMs: Math.round(performance.now() - startedAt) });
  } catch { /* Observation failures must preserve the response. */ }
  return response;
}
