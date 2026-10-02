/** Public support references are identifiers, never arbitrary server text. */
export function assistantSupportId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : undefined;
}

export const ASSISTANT_UNCERTAIN_NOTICE = "A proposed change may still appear. Check proposed actions in PointUp before explicitly retrying; nothing was resent automatically.";

export class AssistantChatRequestError extends Error {
  constructor(readonly requestId: string, readonly status?: number) {
    super("Assistant request could not be confirmed.");
  }
}

/** One attempt only: neither network failure nor an uncertain outcome resends chat. */
export async function requestAssistantChat(body: string, signal: AbortSignal, clientRequestId: string, fetchImpl: typeof fetch = fetch): Promise<{ reply: string; requestId: string }> {
  const fallbackId = assistantSupportId(clientRequestId);
  if (!fallbackId) throw new TypeError("Invalid assistant support reference.");
  let requestId = fallbackId;
  let status: number | undefined;
  try {
    const response = await fetchImpl("/api/v1/assistant/chat", {
      method: "POST", headers: { "Content-Type": "application/json", "X-PointUp-Surface": "web", "x-request-id": fallbackId },
      signal, body,
    });
    requestId = assistantSupportId(response.headers.get("x-request-id"))
      ?? assistantSupportId(response.headers.get("X-PointUp-Request-Id")) ?? fallbackId;
    status = response.status;
    const payload: unknown = await response.json();
    if (!response.ok || !payload || typeof payload !== "object" || !("reply" in payload)
      || typeof payload.reply !== "string" || !payload.reply.trim()) throw new Error("Unconfirmed assistant response");
    return { reply: payload.reply, requestId };
  } catch {
    // Never echo provider/proxy/JSON error text. Persistence may outlive the HTTP
    // request, so a failed response cannot establish that no proposal was saved.
    throw new AssistantChatRequestError(requestId, status);
  }
}

export function assistantChatFailure(error: unknown, aborted: boolean, timedOut: boolean): { message: string; requestId?: string } {
  const status = error instanceof AssistantChatRequestError ? error.status : undefined;
  const reason = aborted ? timedOut ? "The assistant took too long to respond." : "Request stopped."
    : status === 401 || status === 403 ? "Sign in again or check your assistant access."
    : status === 429 ? "The assistant request limit was reached."
    : "The assistant response could not be confirmed.";
  return { message: `${reason} Your question is saved. ${ASSISTANT_UNCERTAIN_NOTICE}`,
    ...(error instanceof AssistantChatRequestError ? { requestId: error.requestId } : {}) };
}
