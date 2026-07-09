import { describe, expect, it, vi } from "vitest";

import {
  CompositeNotifier,
  ConsoleNotifier,
  DiscordWebhookNotifier,
  SlackWebhookNotifier,
  type FetchLike,
} from "../src/infrastructure/notify/webhook-notifiers";
import type { Notifier } from "../src/application/ports";

function okFetch(): { fetchImpl: FetchLike; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => "" };
  };
  return { fetchImpl, calls };
}

describe("webhook notifiers", () => {
  it("Slack posts mrkdwn with the markdown body when present", async () => {
    const { fetchImpl, calls } = okFetch();
    await new SlackWebhookNotifier("https://hooks.slack/x", fetchImpl).notify({
      text: "plain",
      markdown: "*rich*",
    });
    expect(calls[0]?.url).toBe("https://hooks.slack/x");
    expect(calls[0]?.body).toEqual({ text: "*rich*", mrkdwn: true });
  });

  it("Slack falls back to plain text when no markdown", async () => {
    const { fetchImpl, calls } = okFetch();
    await new SlackWebhookNotifier("https://h", fetchImpl).notify({ text: "hello" });
    expect(calls[0]?.body).toEqual({ text: "hello", mrkdwn: true });
  });

  it("Discord posts content and truncates to 2000 chars", async () => {
    const { fetchImpl, calls } = okFetch();
    const long = "x".repeat(2500);
    await new DiscordWebhookNotifier("https://d", fetchImpl).notify({ text: long });
    const body = calls[0]?.body as { content: string };
    expect(body.content).toHaveLength(2000);
  });

  it("throws on a non-2xx webhook response", async () => {
    const failing: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    await expect(
      new SlackWebhookNotifier("https://h", failing).notify({ text: "x" }),
    ).rejects.toThrow(/Slack webhook failed \(500\)/);
  });

  it("Composite fans out to every notifier and rethrows the first failure", async () => {
    const good1 = { notify: vi.fn(async () => undefined) } satisfies Notifier;
    const bad = {
      notify: vi.fn(async () => {
        throw new Error("down");
      }),
    } satisfies Notifier;
    const good2 = { notify: vi.fn(async () => undefined) } satisfies Notifier;

    await expect(
      new CompositeNotifier([good1, bad, good2]).notify({ text: "hi" }),
    ).rejects.toThrow("down");
    // Every channel was still attempted despite the middle failure.
    expect(good1.notify).toHaveBeenCalledOnce();
    expect(good2.notify).toHaveBeenCalledOnce();
  });

  it("ConsoleNotifier does not throw", async () => {
    await expect(new ConsoleNotifier().notify({ text: "hi" })).resolves.toBeUndefined();
  });
});
