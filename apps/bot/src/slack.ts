import { createHmac, timingSafeEqual } from "node:crypto";

import { UserId } from "@pointup/core";

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
): UserId {
  return UserId.parse(defaultUserId ?? platformUserId);
}

/** Post a deferred reply only to Slack's documented HTTPS callback origins. */
export async function postToSlack(responseUrl: string, text: string): Promise<void> {
  try {
    const url = new URL(responseUrl);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "hooks.slack.com" &&
        url.hostname !== "hooks.slack-gov.com") ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.hash !== ""
    ) {
      throw new Error("Invalid Slack callback destination");
    }
    // Keep request authority literal; callback data supplies only path/query.
    // Concatenation preserves // paths without treating them as a new host.
    const callbackPath =
      url.pathname + (url.search || (url.href.endsWith("?") ? "?" : ""));
    const endpoint =
      url.hostname === "hooks.slack.com"
        ? `https://hooks.slack.com${callbackPath}`
        : `https://hooks.slack-gov.com${callbackPath}`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    // Callback URLs and transport exceptions can contain callback credentials.
    console.warn("[bot] failed to post deferred Slack reply");
  }
}
