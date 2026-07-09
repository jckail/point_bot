import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Slack slash-command request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * signature == "v0=" + HMAC_SHA256(signingSecret, `v0:${timestamp}:${rawBody}`)
 * Requests older than 5 minutes are rejected (replay protection).
 */
export function verifySlackSignature(params: {
  readonly rawBody: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly signingSecret: string;
  readonly nowMs: number;
}): boolean {
  const { rawBody, signature, timestamp, signingSecret, nowMs } = params;
  if (!signature || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs / 1000 - ts) > 300) return false;

  const expected =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SlackCommand {
  readonly command: string;
  readonly text: string;
  readonly userId: string;
}

/** Parse Slack's application/x-www-form-urlencoded slash-command body. */
export function parseSlackCommand(rawBody: string): SlackCommand {
  const params = new URLSearchParams(rawBody);
  return {
    command: params.get("command") ?? "",
    text: params.get("text") ?? "",
    userId: params.get("user_id") ?? "",
  };
}

/**
 * Self-hosted personal mode maps every request to a single configured user;
 * otherwise the Slack user id is used directly as the app user id.
 */
export function resolveUserId(
  defaultUserId: string | undefined,
  platformUserId: string,
): string {
  return defaultUserId ?? platformUserId;
}
