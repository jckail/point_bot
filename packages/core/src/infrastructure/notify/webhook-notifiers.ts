import type { Notifier, OutboundNotification } from "../../application/ports";

/** Minimal fetch signature so adapters can be unit-tested without a network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    redirect: "error";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; body?: { cancel(): Promise<void> } | null }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  payload: unknown,
  channel: string,
): Promise<void> {
  // Preserve path/query credentials while rejecting ambiguous or unsafe URLs.
  // URL parser errors can echo their input, so only a fixed error escapes.
  try {
    if (/[\s\\]/.test(url) || url.includes("#") || /^[^:]+:\/\/[^/?#]*@/.test(url)) throw new Error();
    const parsed = new URL(url);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
      || parsed.username || parsed.password || parsed.hash) throw new Error();
  } catch { throw new Error(`${channel} webhook failed`); }
  // Network exceptions and upstream bodies can contain webhook secrets or
  // notification content. Neither is inspected or attached as an error cause.
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    // Drop the response stream without reading potentially private content.
    try { await response.body?.cancel(); } catch { /* Best-effort resource release. */ }
    if (response.ok) return;
  } catch { /* Translate every transport failure to a fixed diagnostic. */ }
  throw new Error(`${channel} webhook failed`);
}

/**
 * Posts to a Slack Incoming Webhook. Uses Slack `mrkdwn` when a markdown body
 * is supplied, otherwise the plain text.
 */
export class SlackWebhookNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async notify(notification: OutboundNotification): Promise<void> {
    await postJson(
      this.fetchImpl,
      this.webhookUrl,
      { text: notification.markdown ?? notification.text, mrkdwn: true },
      "Slack",
    );
  }
}

/**
 * Posts to a Discord webhook. Discord renders standard markdown in `content`
 * and caps messages at 2000 characters.
 */
export class DiscordWebhookNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async notify(notification: OutboundNotification): Promise<void> {
    const content = (notification.markdown ?? notification.text).slice(0, 2000);
    await postJson(this.fetchImpl, this.webhookUrl, { content }, "Discord");
  }
}

/** Logs instead of sending; useful for local development and tests. */
export class ConsoleNotifier implements Notifier {
  async notify(notification: OutboundNotification): Promise<void> {
    console.info(`[console-notifier]\n${notification.text}`);
  }
}

/**
 * Fans a notification out to several channels, isolating failures: one
 * channel erroring does not prevent delivery to the others (the first error
 * is rethrown after all have been attempted).
 */
export class CompositeNotifier implements Notifier {
  constructor(private readonly notifiers: readonly Notifier[]) {}

  async notify(notification: OutboundNotification): Promise<void> {
    const results = await Promise.allSettled(
      this.notifiers.map((n) => n.notify(notification)),
    );
    const firstError = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (firstError) throw firstError.reason;
  }
}
