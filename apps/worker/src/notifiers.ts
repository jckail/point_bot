import {
  CompositeNotifier,
  DiscordWebhookNotifier,
  SlackWebhookNotifier,
  type Notifier,
} from "@pointup/core";

import type { WorkerEnv } from "./env";

/**
 * Builds a fan-out notifier from whatever chat webhooks are configured, or
 * returns null when none are — in which case digests are email-only.
 */
export function createNotifier(env: WorkerEnv): Notifier | null {
  const notifiers: Notifier[] = [];
  if (env.SLACK_WEBHOOK_URL) {
    notifiers.push(new SlackWebhookNotifier(env.SLACK_WEBHOOK_URL));
  }
  if (env.DISCORD_WEBHOOK_URL) {
    notifiers.push(new DiscordWebhookNotifier(env.DISCORD_WEBHOOK_URL));
  }
  return notifiers.length > 0 ? new CompositeNotifier(notifiers) : null;
}
