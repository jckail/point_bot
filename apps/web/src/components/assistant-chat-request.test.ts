import { describe, expect, it } from "vitest";
import { ASSISTANT_CHAT_BODY_LIMIT, serializeAssistantChatRequest } from "./assistant-chat-request";

const bytes = (body: string) => new TextEncoder().encode(body).byteLength;

describe("assistant chat request byte budget", () => {
  it("keeps small history unchanged and preserves the displayed transcript", () => {
    const history = Object.freeze([{ role: "assistant" as const, content: "Earlier advice" }]);
    expect(serializeAssistantChatRequest("Question", history)).toBe(JSON.stringify({ message: "Question", history }));
    expect(history).toHaveLength(1);
  });

  it("drops oldest Unicode turns using the actual serialized UTF-8 body including the question", () => {
    const message = "旅".repeat(4000);
    const history = Array.from({ length: 8 }, (_, index) => ({ role: "assistant" as const, content: `${index}${"旅".repeat(3999)}` }));
    const displayed = structuredClone(history);
    const body = serializeAssistantChatRequest(message, history);
    const parsed = JSON.parse(body) as { message: string; history: typeof history };
    expect(bytes(body)).toBeLessThanOrEqual(ASSISTANT_CHAT_BODY_LIMIT);
    expect(parsed.message).toBe(message);
    expect(parsed.history).toEqual(history.slice(-1));
    expect(bytes(JSON.stringify({ message, history: history.slice(-2) }))).toBeGreaterThan(ASSISTANT_CHAT_BODY_LIMIT);
    expect(history).toEqual(displayed);
  });

  it("counts JSON escaping and can discard all history without altering the question", () => {
    const message = "\u0000".repeat(4000);
    const history = [{ role: "user" as const, content: "\u0000".repeat(4000) }];
    const body = serializeAssistantChatRequest(message, history);
    expect(bytes(body)).toBeLessThanOrEqual(ASSISTANT_CHAT_BODY_LIMIT);
    expect(JSON.parse(body)).toEqual({ message, history: [] });
  });

  it("refuses an oversized question rather than silently changing it", () => {
    expect(() => serializeAssistantChatRequest("旅".repeat(ASSISTANT_CHAT_BODY_LIMIT), [])).toThrow(RangeError);
  });
});
