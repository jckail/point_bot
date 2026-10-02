export class AgentApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); }
}
export async function agentRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...options, cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-PointUp-Surface": "web", ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      && payload.error && typeof payload.error === "object" && "message" in payload.error
      && typeof payload.error.message === "string" ? payload.error.message : "The request could not be completed. Refresh the list before trying again.";
    throw new AgentApiError(message, response.headers.get("X-PointUp-Request-Id") ?? undefined);
  }
  return payload;
}
export function agentError(error: unknown): string {
  if (error instanceof AgentApiError) return `${error.message}${error.requestId ? ` Support reference: ${error.requestId}` : ""}`;
  if (error instanceof DOMException && error.name === "TimeoutError") return "The request took too long. Refresh the list to check whether it completed.";
  return "The request could not be completed. Refresh the list to check whether it completed.";
}
export function displayDate(value: string): string {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function requestReviewedAction(id: string, decision: "approve" | "reject"): Promise<unknown> {
  return agentRequest(`/api/v1/assistant/actions/${encodeURIComponent(id)}/${decision}`, { method: "POST", body: "{}" });
}
