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
      text: vi.fn(async () => { throw new Error("private upstream body must not be read"); }),
    });
    await expect(
      new SlackWebhookNotifier("https://h", failing).notify({ text: "x" }),
    ).rejects.toThrow(/^Slack webhook failed$/);
  });

  it("replaces private transport exceptions without retaining a cause", async () => {
    const secret = "private-webhook-url-and-body";
    const thrown = Object.defineProperty(new Error(secret), "cause", {
      get: () => { throw new Error("cause must not be read"); },
    });
    const failing: FetchLike = async () => { throw thrown; };
    try {
      await new DiscordWebhookNotifier(`https://hooks/${secret}`, failing).notify({ text: secret });
      throw new Error("expected delivery failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Discord webhook failed");
      expect(Object.hasOwn(error as object, "cause")).toBe(false);
    }
  });

  it.each([
    "http://hooks.slack.com/private", "https://user:secret@hooks.slack.com/x",
    "https://hooks.slack.com/x#secret", "https://hooks.slack.com/x#", "https://@hooks.slack.com/x", " https://hooks.slack.com/x",
    "https://hooks.slack.com/x\\secret", "https://hooks.slack.com/x\n",
  ])("rejects unsafe webhook URL without sending its notification: %s", async url => {
    const fetchImpl = vi.fn();
    await expect(new SlackWebhookNotifier(url, fetchImpl).notify({ text: "private" }))
      .rejects.toThrow(/^Slack webhook failed$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disables redirects, preserves legitimate path/query tokens and cancels without reading", async () => {
    const cancel = vi.fn(async () => undefined);
    const text = vi.fn(async () => "private response");
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 302, text, body: { cancel } }));
    const url = "https://hooks.slack.com/services/private/path?token=private%2Fvalue";
    await expect(new SlackWebhookNotifier(url, fetchImpl).notify({ text: "private notification" }))
      .rejects.toThrow(/^Slack webhook failed$/);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it("allows HTTP only for local fixtures", async () => {
    const { fetchImpl, calls } = okFetch();
    await new SlackWebhookNotifier("http://127.0.0.1:9999/webhook?fixture=1", fetchImpl)
      .notify({ text: "fixture" });
    expect(calls).toHaveLength(1);
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
