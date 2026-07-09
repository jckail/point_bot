import { describe, expect, it } from "vitest";

import {
  BedrockAssistant,
  type BedrockConverseClient,
  type BedrockConverseInput,
  type BedrockConverseOutput,
} from "../src/infrastructure/llm/bedrock-assistant";

function fakeClient(
  respond: (input: BedrockConverseInput) => BedrockConverseOutput,
): { client: BedrockConverseClient; calls: BedrockConverseInput[] } {
  const calls: BedrockConverseInput[] = [];
  return {
    calls,
    client: {
      converse: async (input) => {
        calls.push(input);
        return respond(input);
      },
    },
  };
}

describe("BedrockAssistant", () => {
  it("sends the system prompt and returns concatenated text blocks", async () => {
    const { client, calls } = fakeClient(() => ({
      output: { message: { content: [{ text: "Transfer " }, { text: "UR to Hyatt." }] } },
      stopReason: "end_turn",
    }));

    const assistant = new BedrockAssistant({ modelId: "test-sonnet", client });
    const reply = await assistant.complete({
      system: "You are the PointUp assistant.",
      messages: [{ role: "user", content: "What's my best transfer?" }],
    });

    expect(reply).toBe("Transfer UR to Hyatt.");
    expect(calls[0]?.modelId).toBe("test-sonnet");
    expect(calls[0]?.system).toEqual([{ text: "You are the PointUp assistant." }]);
    expect(calls[0]?.messages).toEqual([
      { role: "user", content: [{ text: "What's my best transfer?" }] },
    ]);
  });

  it("maps system-role messages to user and merges consecutive same-role turns", async () => {
    const { client, calls } = fakeClient(() => ({
      output: { message: { content: [{ text: "ok" }] } },
    }));

    const assistant = new BedrockAssistant({ modelId: "m", client });
    await assistant.complete({
      system: "",
      messages: [
        { role: "system", content: "context line" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "assistant", content: "again" },
      ],
    });

    // system -> user, then merged with the following user turn; the two
    // assistant turns merge into one. Result alternates user/assistant.
    expect(calls[0]?.messages).toEqual([
      { role: "user", content: [{ text: "context line" }, { text: "hello" }] },
      { role: "assistant", content: [{ text: "hi" }, { text: "again" }] },
    ]);
    // No system block sent when the system prompt is empty.
    expect(calls[0]?.system).toBeUndefined();
  });

  it("throws when Bedrock returns no text", async () => {
    const { client } = fakeClient(() => ({ output: { message: { content: [] } }, stopReason: "max_tokens" }));
    const assistant = new BedrockAssistant({ modelId: "m", client });

    await expect(
      assistant.complete({ system: "s", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/empty completion/);
  });
});
