import { PointUpApiError, type PointUpClient } from "@pointup/api-client";

import type { ExtractedBalance } from "./extraction";
import type { RecordResult } from "./messages";

/** Personal access tokens (Dashboard -> Agents) start with this prefix. */
export const PAT_PREFIX = "pu_";

/** Pure-ish and testable: all I/O goes through the injected client. */
export function recordCapture(
  api: PointUpClient,
  token: string,
  capture: ExtractedBalance,
): Promise<RecordResult> {
  return token.startsWith(PAT_PREFIX)
    ? submitViaAgentEndpoint(api, capture)
    : recordViaSession(api, capture);
}

function describeApiError(error: unknown): RecordResult {
  if (error instanceof PointUpApiError) {
    if (error.code === "CONSENT_REQUIRED") {
      return {
        ok: false,
        message:
          "No consent for this program. Grant it in PointUp (Dashboard > Agents), then try again.",
      };
    }
    if (error.code === "SKILL_NOT_FOUND") {
      return { ok: false, message: "PointUp has no capture skill for this program yet." };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        ok: false,
        message: `Not allowed (${error.status} ${error.code}): check the token's scopes (needs observations:write).`,
      };
    }
    return { ok: false, message: `API error (${error.status}): ${error.message}` };
  }
  return { ok: false, message: "Could not reach the PointUp API." };
}

/** PAT path: consent-gated, host-allow-listed, audited write-back. */
async function submitViaAgentEndpoint(
  api: PointUpClient,
  capture: ExtractedBalance,
): Promise<RecordResult> {
  if (!capture.sourceUrl) {
    return { ok: false, message: "Capture has no source page; reload the provider page." };
  }
  try {
    const result = await api.submitObservation({
      skillId: `${capture.providerId}.capture-balance`,
      points: capture.points,
      sourceUrl: capture.sourceUrl,
      agent: "pointup-extension",
    });
    if (result.outcome === "needs_review") {
      return {
        ok: false,
        message: `Held for review: ${result.message} Confirm it in PointUp.`,
      };
    }
    return { ok: true, message: result.message };
  } catch (error) {
    return describeApiError(error);
  }
}

/** Legacy session-token path: manual snapshot on an already-linked account. */
async function recordViaSession(
  api: PointUpClient,
  capture: ExtractedBalance,
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
    await api.recordManualBalance(account.id, { points: capture.points });
    return {
      ok: true,
      message: `Recorded ${capture.points.toLocaleString("en-US")} for ${account.provider.displayName}.`,
    };
  } catch (error) {
    return describeApiError(error);
  }
}
