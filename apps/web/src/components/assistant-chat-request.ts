/** Matches the bounded chat body reader, including JSON framing and UTF-8. */
export const ASSISTANT_CHAT_BODY_LIMIT = 32 * 1024;

type HistoryTurn = { readonly role: "user" | "assistant"; readonly content: string };

/** Preserve the displayed transcript; send the largest recent history suffix that fits. */
export function serializeAssistantChatRequest(message: string, history: readonly HistoryTurn[]): string {
  const recent = history.map(({ role, content }) => ({ role, content }));
  const encoder = new TextEncoder();
  let body = JSON.stringify({ message, history: recent });
  while (encoder.encode(body).byteLength > ASSISTANT_CHAT_BODY_LIMIT && recent.length > 0) {
    recent.shift();
    body = JSON.stringify({ message, history: recent });
  }
  if (encoder.encode(body).byteLength > ASSISTANT_CHAT_BODY_LIMIT) {
    throw new RangeError("Assistant message exceeds the request size limit");
  }
  return body;
}
