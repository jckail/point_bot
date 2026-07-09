import type { Notifier, OutboundNotification } from "../../application/ports";

/** Minimal fetch signature so adapters can be unit-tested without a network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init as RequestInit);

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  payload: unknown,
  channel: string,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${channel} webhook failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }
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
