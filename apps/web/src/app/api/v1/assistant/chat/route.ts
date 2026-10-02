import { randomUUID } from "node:crypto";
import { chatAssistantRequestSchema } from "@pointup/core/contracts";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { getContainer } from "@/server/container";
import { readJsonBody, withAuthenticatedUser } from "@/server/http";
import { assistantConfig } from "@/server/assistant-agent/config";
import { getAssistantActions } from "@/server/assistant-agent/actions";
import { runPortfolioAssistant } from "@/server/assistant-agent";
import { assistantAdmission } from "@/server/assistant-agent/admission";

/** User-scoped assistant shared by the web app and extension. */
export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const sourceHeader = request.headers.get("X-PointUp-Surface");
  const source = sourceHeader === "extension" || sourceHeader === "web" ? sourceHeader : "api";
  let mode = "fallback";
  let traceId: string | undefined;
  const response = await withAuthenticatedUser(async (userId, principal) => {
    const body = chatAssistantRequestSchema.parse(await readJsonBody(request));
    const lease = assistantAdmission.acquire(userId);
    if ("retryAfter" in lease) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Assistant request limit reached. Try again shortly." } },
      { status: 429, headers: { "Retry-After": String(lease.retryAfter), "Cache-Control": "private, no-store" } },
    );
    try {
      const configured = assistantConfig(env);
      // MV3 can stop a worker when fetch waits over 30s; leave response margin.
      // A client-supplied surface can only reduce the configured server deadline.
      const config = source === "extension" ? { ...configured, timeoutMs: Math.min(configured.timeoutMs, 20_000) } : configured;
      mode = config.runtime === "agents" ? "agents" : "fallback";
      if (mode === "agents" && config.tracing) traceId = `trace_${requestId.replaceAll("-", "")}`;
      const actions = principal.kind !== "agent" || principal.scopes.includes("actions:propose") ? getAssistantActions() : undefined;
      const result = await runPortfolioAssistant({ actions, userId, body, useCases: getContainer().useCases, config, requestId, traceId, source, signal: request.signal });
      traceId = result.traceId;
      return NextResponse.json({ reply: result.reply, ...(result.actions ? { actions: result.actions } : {}) });
    } finally { lease.release(); }
  }, { request, scope: "assistant:chat" });
  response.headers.set("X-PointUp-Request-Id", requestId);
  response.headers.set("X-PointUp-Assistant-Mode", mode);
  if (traceId) response.headers.set("X-PointUp-Trace-Id", traceId);
  // Admission and setup failures need the same support reference as SDK runs.
  // This separate component never contributes to started-run metrics.
  try {
    console.info(JSON.stringify({ component: "pointup_assistant_http", event: response.ok ? "request_completed" : "request_failed", requestId, surface: source, httpStatus: response.status, durationMs: Math.round(performance.now() - startedAt) }));
  } catch { /* Telemetry must never determine HTTP success. */ }
  return response;
}
