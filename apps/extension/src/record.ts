import { PointUpApiError, type PointUpClient, type SubmitObservationRequest } from "@pointup/api-client";

import { observationRequest, type ReviewedCapture } from "./capture-state";
import type { RecordResult } from "./messages";

/** Personal access tokens (Dashboard -> Agents) start with this prefix. */
export const PAT_PREFIX = "pu_";

/** Pure-ish and testable: all I/O goes through the injected client. */
export function recordCapture(
  api: PointUpClient,
  token: string,
  capture: ReviewedCapture,
  request: SubmitObservationRequest = observationRequest(capture),
): Promise<RecordResult> {
  return token.startsWith(PAT_PREFIX)
    ? submitViaAgentEndpoint(api, capture, request)
    : recordViaSession(api, capture);
}

function describeApiError(error: unknown, path: "pat" | "session"): RecordResult {
  let message = "Could not reach the PointUp API. Your capture is retained.";
  if (error instanceof Error && error.name === "TimeoutError") {
    message = path === "pat"
      ? "The request took too long. Your capture is retained. Retry with this same review to recover its receipt."
      : "The request took too long. Your capture is retained. Check PointUp before repeating a manual balance write.";
  } else if (error instanceof PointUpApiError) {
    if (error.code === "OBSERVATION_REPLAY_CONFLICT") {
      message = "This capture conflicts with an earlier submission. Check PointUp > Dashboard > Agents before discarding it and creating a new capture.";
    } else if (error.code === "CONSENT_REQUIRED") {
      message = "No consent for this program. Grant it in PointUp (Dashboard > Agents), then try again.";
    } else if (error.code === "SKILL_NOT_FOUND") {
      message = "PointUp has no capture skill for this program yet.";
    } else if (error.status === 401 || error.status === 403) {
      message = path === "pat"
        ? "Not allowed. Check that your PointUp personal access token is active and has observations:write."
        : "Your PointUp session is not authorized. Sign in to PointUp again and update the extension's session token.";
    } else if (error.status === 429) {
      message = "PointUp is receiving too many requests. Your capture is retained. Try again shortly.";
    } else {
      message = path === "pat"
        ? "PointUp could not save this capture. Keep this review and retry to recover its receipt."
        : "PointUp could not save this capture. Check PointUp before repeating a manual balance write.";
    }
  }
  // Match the shared HTTP request-id format; never echo arbitrary provider text.
  if (error instanceof PointUpApiError && typeof error.requestId === "string" &&
      /^[A-Za-z0-9._:-]{8,128}$/.test(error.requestId)) {
    message += ` Support reference: ${error.requestId}.`;
  }
  return { ok: false, message };
}

/** PAT path: consent-gated, host-allow-listed, audited write-back. */
async function submitViaAgentEndpoint(
  api: PointUpClient,
  capture: ReviewedCapture,
  request: SubmitObservationRequest,
): Promise<RecordResult> {
  if (!capture.sourceUrl) {
    return { ok: false, message: "Capture has no source page; reload the provider page." };
  }
  try {
    const result = await api.submitObservation(request);
    const receipt = { outcome: result.outcome, observationId: result.observationId, reviewId: result.reviewId };
    if (result.outcome === "needs_review") {
      return {
        ...receipt, ok: false,
        message:
          "Held for review, not saved: this value looks unusual. Open PointUp > Dashboard > Agents to confirm or reject it.",
      };
    }
    if (result.outcome === "rejected") return { ...receipt, ok: false, message: "Observation rejected. Check PointUp > Dashboard > Agents before creating another capture." };
    if (result.outcome === "recorded" || result.outcome === "unchanged") return { ...receipt, ok: true, message: result.message };
    return { ok: false, message: "Unexpected observation response. Keep this capture and retry to recover its receipt." };
  } catch (error) {
    return describeApiError(error, "pat");
  }
}

/** Legacy session-token path: manual snapshot on an already-linked account. */
async function recordViaSession(
  api: PointUpClient,
  capture: ReviewedCapture,
): Promise<RecordResult> {
  try {
    const accounts = await api.listLoyaltyAccounts();
    const account = accounts.find((a) => a.provider.id === capture.providerId);
    if (!account) {
      return {
        ok: false,
        message: `No linked ${capture.providerId} account — link it in PointUp first.`,
      };
    }
    await api.recordManualBalance(account.id, { points: capture.points, capturedAt: capture.observedAt });
    return {
      ok: true,
      message: `Recorded ${capture.points.toLocaleString("en-US")} for ${account.provider.displayName}.`,
    };
  } catch (error) {
    return describeApiError(error, "session");
  }
}
