import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { editDiscordReply } from "../src/discord";

const fetchMock = vi.fn<typeof fetch>();
const APP_ID = "123456789012345678";

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

describe("deferred Discord transport", () => {
  it("edits the fixed HTTPS endpoint and preserves the content limit", async () => {
    await editDiscordReply(APP_ID, "opaque_token-123", "x".repeat(2001));

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `https://discord.com/api/v10/webhooks/${APP_ID}/opaque_token-123/messages/@original`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "x".repeat(2000) }),
        signal: expect.any(AbortSignal),
        redirect: "error",
      },
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("encodes an opaque token as one path segment without query or fragment injection", async () => {
    await editDiscordReply(APP_ID, "opaque/token?secret#fragment%25", "Reply");

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `https://discord.com/api/v10/webhooks/${APP_ID}/opaque%2Ftoken%3Fsecret%23fragment%2525/messages/@original`,
      expect.objectContaining({ method: "PATCH", redirect: "error" }),
    );
  });

  it("accepts the maximum uint64 application ID", async () => {
    await editDiscordReply("18446744073709551615", "token", "Reply");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://discord.com/api/v10/webhooks/18446744073709551615/token/messages/@original",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each(["", "0", "01", "abc", "123/other", "123?query", "18446744073709551616", "1".repeat(21)])(
    "rejects invalid application ID %s before sending a request",
    async (appId) => {
      await expect(editDiscordReply(appId, "token", "Reply")).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(
        "[bot] failed to edit deferred Discord reply",
      );
    },
  );

  it.each(["", ".", "..", "token\ncontrol", "token\u0000control", "token\u007fcontrol", "\ud800", "x".repeat(4097)])(
    "rejects invalid opaque token %# before sending a request",
    async (token) => {
      await expect(editDiscordReply(APP_ID, token, "Reply")).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(
        "[bot] failed to edit deferred Discord reply",
      );
    },
  );

  it("keeps transport and redirect failures private without retrying", async () => {
    const token = "private-interaction-canary";
    fetchMock.mockRejectedValue(new Error(`redirect blocked for /${token}/ with private details`));

    await expect(editDiscordReply(APP_ID, token, "Private portfolio canary")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://discord.com/api/v10/webhooks/${APP_ID}/${token}/messages/@original`,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      "[bot] failed to edit deferred Discord reply",
    );
  });
});
