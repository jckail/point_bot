import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postToSlack } from "../src/slack";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deferred Slack transport", () => {
  it.each([
    "https://hooks.slack.com/services/T/B/synthetic-token",
    "https://hooks.slack-gov.com/actions/T/B/synthetic-token?opaque=value",
    "https://hooks.slack.com:443/actions/T/B/synthetic-token",
  ])("posts to documented callback origin %s without following redirects", async (endpoint) => {
    await postToSlack(endpoint, "A private reply");

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(new URL(endpoint).href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text: "A private reply" }),
      signal: expect.any(AbortSignal),
      redirect: "error",
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(
    ["hooks.slack.com", "hooks.slack-gov.com"].flatMap((host) =>
      [
        "//attacker.invalid/actions",
        "/%2f%2fattacker.invalid/%5c?opaque=%2f%2felsewhere.invalid",
        "/actions?next=https://attacker.invalid/reply",
        "/actions?",
      ].map((path) => [host, path]),
    ),
  )("keeps callback authority fixed for %s path %s", async (host, path) => {
    const endpoint = `https://${host}${path}`;
    await postToSlack(endpoint, "A private reply");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = fetchMock.mock.calls[0]![0];
    const destination = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    expect(destination.origin).toBe(`https://${host}`);
    expect(destination.href).toBe(new URL(endpoint).href);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    "http://hooks.slack.com/actions/T/B/token",
    "https://hooks.slack.com:8443/actions/T/B/token",
    "https://user:password@hooks.slack.com/actions/T/B/token",
    "https://user@hooks.slack-gov.com/actions/T/B/token",
    "https://hooks.slack.com.attacker.invalid/actions/T/B/token",
    "https://attacker.invalid/?next=https://hooks.slack.com/actions/T/B/token",
    "https://slack.com/actions/T/B/token",
    "https://hooks.slack.com./actions/T/B/token",
    "https://127.0.0.1/actions/T/B/token",
    "https://hooks.slack.com/actions/T/B/token#fragment",
    "not a URL",
  ])("rejects destination %s before sending a request", async (endpoint) => {
    await expect(postToSlack(endpoint, "A private reply")).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      "[bot] failed to post deferred Slack reply",
    );
  });

  it("keeps transport and redirect failures private without retrying", async () => {
    const endpoint = "https://hooks.slack.com/actions/T/B/private-callback-canary";
    fetchMock.mockRejectedValue(new Error(`redirect blocked for ${endpoint}`));

    await expect(postToSlack(endpoint, "Private portfolio canary")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ redirect: "error" }));
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      "[bot] failed to post deferred Slack reply",
    );
  });
});
