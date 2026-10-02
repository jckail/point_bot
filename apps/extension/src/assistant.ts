import { PointUpApiError, PointUpClient } from "@pointup/api-client";
import { loadConfig, type ExtensionConfig } from "./config";
import type { ActionReview, ChatEntry, ChatPending, ChatResult } from "./messages";
import { openOwnedReviewTab } from "./review-tab";
import { canonicalApiOrigin, configuredApiOrigin } from "./api-origin";

export const CHAT_TIMEOUT_MS = 25_000;
export const CHAT_HISTORY_LIMIT = 16;
const CHAT_BODY_LIMIT_BYTES = 32 * 1024;
const CHAT_KEY = "assistantChat";
const CHAT_SCOPE_KEY = "assistantChatScope";
const CHAT_PENDING_KEY = "assistantChatPending";
let activeRequestId: string | undefined;
let preparingRequest: Promise<void> | undefined;
const UNCERTAIN_MESSAGE = "The previous request outcome is unknown. Your question is saved. Check proposed actions in PointUp before explicitly retrying; nothing was resent automatically.";
async function chatScope(baseUrl: string, token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${baseUrl}\0${token}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function supportId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}
export function actionReviews(value: unknown): ActionReview[] {
  if (!Array.isArray(value)) return [];
  return value.filter((action): action is ActionReview => Boolean(action) && typeof action === "object"
    && ["id", "kind", "status", "title", "summary", "expiresAt"].every(key => typeof action[key] === "string"))
    .slice(0, 20).map(a => ({ id: a.id.slice(0, 128), kind: a.kind.slice(0, 64), status: a.status.slice(0, 64),
      title: a.title.slice(0, 200), summary: a.summary.slice(0, 2000), expiresAt: a.expiresAt.slice(0, 64) }));
}
export function boundedChat(value: unknown): ChatEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ChatEntry => Boolean(entry) && typeof entry === "object"
    && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string"
    && entry.content.trim().length > 0 && entry.content.length <= 4000).slice(-CHAT_HISTORY_LIMIT)
    .map(entry => ({ role: entry.role, content: entry.content,
      ...(entry.role === "assistant" ? { requestId: supportId(entry.requestId), mode: supportId(entry.mode),
        traceId: supportId(entry.traceId), actions: actionReviews(entry.actions) } : {}) }));
}
function chatRequest(message: string, entries: readonly ChatEntry[]) {
  const body = { message, history: entries.map(({ role, content }) => ({ role, content })) };
  const encoder = new TextEncoder();
  // Measure the complete JSON body, including escaped text and the current question.
  while (body.history.length && encoder.encode(JSON.stringify(body)).byteLength > CHAT_BODY_LIMIT_BYTES) {
    body.history.shift();
  }
  return body;
}
export async function loadChat(config?: ExtensionConfig): Promise<ChatEntry[]> {
  const scopeConfig = config ?? await loadConfig();
  const stored = await chrome.storage.session.get([CHAT_KEY, CHAT_SCOPE_KEY]);
  if (stored[CHAT_SCOPE_KEY] !== await chatScope(scopeConfig.baseUrl, scopeConfig.token)) return [];
  return boundedChat(stored[CHAT_KEY]);
}
export async function loadChatState(): Promise<ChatResult> {
  // A popup reopening immediately after Ask waits only for durable preparation,
  // never for inference, so it cannot miss the pending envelope and stop polling.
  await preparingRequest;
  const config = await loadConfig();
  const stored = await chrome.storage.session.get([CHAT_KEY, CHAT_SCOPE_KEY, CHAT_PENDING_KEY]);
  if (stored[CHAT_SCOPE_KEY] !== await chatScope(config.baseUrl, config.token)) return { ok: true, message: "", chat: [] };
  const candidate = stored[CHAT_PENDING_KEY] as Partial<ChatPending> & { requestId?: string } | undefined;
  let pending: ChatPending | undefined;
  if (candidate && typeof candidate.question === "string" && candidate.question.trim() && candidate.question.length <= 4000
    && supportId(candidate.requestId) && ["in_flight", "uncertain"].includes(candidate.status ?? "")) {
    const inFlight = candidate.status === "in_flight" && candidate.requestId === activeRequestId;
    pending = { question: candidate.question, status: inFlight ? "in_flight" : "uncertain",
      message: inFlight ? "The assistant is working. Your question is saved."
        : candidate.status === "uncertain" && typeof candidate.message === "string" && candidate.message.length <= 1000
          ? candidate.message : `${UNCERTAIN_MESSAGE} Support reference: ${candidate.requestId}` };
  }
  const current = await loadConfig();
  if (current.baseUrl !== config.baseUrl || current.token !== config.token) return { ok: true, message: "", chat: [] };
  return { ok: true, message: "", chat: boundedChat(stored[CHAT_KEY]), ...(pending ? { pending } : {}) };
}
export async function clearChat(): Promise<ChatResult> {
  await chrome.storage.session.remove(CHAT_KEY);
  await chrome.storage.session.remove(CHAT_SCOPE_KEY);
  await chrome.storage.session.remove(CHAT_PENDING_KEY);
  return { ok: true, message: "Conversation cleared.", chat: [] };
}
export function pointUpOrigin(value: string): string {
  return canonicalApiOrigin(value);
}
export function assistantFailure(error: unknown, requestId?: string): string {
  const message = error instanceof PointUpApiError && [401, 403].includes(error.status)
    ? "Token expired or scope denied. Check your PointUp token has portfolio:read, then retry."
    : error instanceof Error && error.name === "TimeoutError"
      ? "The assistant took too long to respond. Your conversation is saved; retry your question."
      : "The assistant could not respond. Your conversation is saved; retry your question.";
  const reference = supportId(requestId) ?? (error instanceof PointUpApiError ? supportId(error.requestId) : undefined);
  return `${message}${reference ? ` Support reference: ${reference}` : ""}`;
}
export function askAssistant(question: unknown): Promise<ChatResult> {
  let ready!: () => void;
  const preparation = new Promise<void>(resolve => { ready = resolve; });
  preparingRequest = preparation;
  const prepared = () => {
    if (preparingRequest === preparation) preparingRequest = undefined;
    ready();
  };
  return runAssistant(question, prepared).finally(prepared);
}
async function runAssistant(question: unknown, prepared: () => void): Promise<ChatResult> {
  if (typeof question !== "string" || !question.trim() || question.length > 4000) {
    return { ok: false, message: "Enter a question between 1 and 4,000 characters." };
  }
  const config = await loadConfig();
  if (!config.baseUrl || !config.token) return { ok: false, message: "Save your PointUp API URL and token first." };
  let baseUrl: string;
  try { baseUrl = configuredApiOrigin(config.baseUrl); } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Save a valid PointUp URL first." }; }
  const history = await loadChat(config);
  const requestId = crypto.randomUUID();
  const scope = await chatScope(config.baseUrl, config.token);
  let diagnostics: Pick<ChatEntry, "requestId" | "mode" | "traceId"> = {};
  const api = new PointUpClient({ baseUrl, timeoutMs: CHAT_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${config.token}`, "X-PointUp-Surface": "extension", "x-request-id": requestId },
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error", credentials: "omit" });
      diagnostics = { requestId: supportId(response.headers.get("X-PointUp-Request-Id")) ?? supportId(response.headers.get("x-request-id")),
        mode: supportId(response.headers.get("X-PointUp-Assistant-Mode")), traceId: supportId(response.headers.get("X-PointUp-Trace-Id")) };
      return response;
    } });
  try {
    activeRequestId = requestId;
    await chrome.storage.session.set({ [CHAT_KEY]: history, [CHAT_SCOPE_KEY]: scope,
      [CHAT_PENDING_KEY]: { requestId, question: question.trim(), status: "in_flight" } });
    prepared();
    // Send only typed conversation, never balances, source pages, or browser tab data.
    const result = await api.chatWithAssistant(chatRequest(question.trim(), history));
    const current = await loadConfig();
    if (current.baseUrl !== config.baseUrl || current.token !== config.token) return { ok: false, message: "API settings changed. Ask your question again." };
    if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("Empty assistant response");
    const chat: ChatEntry[] = [...history, { role: "user" as const, content: question.trim() },
      { role: "assistant" as const, content: result.reply.slice(0, 4000), ...diagnostics, actions: actionReviews(result.actions) }].slice(-CHAT_HISTORY_LIMIT);
    await chrome.storage.session.set({ [CHAT_KEY]: chat, [CHAT_SCOPE_KEY]: scope, [CHAT_PENDING_KEY]: null });
    return { ok: true, message: "", chat };
  } catch (error) {
    const current = await loadConfig();
    if (current.baseUrl !== config.baseUrl || current.token !== config.token) return { ok: false, message: "API settings changed. Ask your question again." };
    // This ID is diagnostic correlation only, never proposal/write idempotency.
    const reference = diagnostics.requestId ?? (error instanceof PointUpApiError ? supportId(error.requestId) : undefined) ?? requestId;
    const unknown = error instanceof PointUpApiError ? "" : " The request outcome is unknown.";
    const message = `${assistantFailure(error, reference)}${unknown} Check proposed actions in PointUp before explicitly retrying; nothing was resent automatically.`;
    const pending: ChatPending = { question: question.trim(), status: "uncertain", message };
    await chrome.storage.session.set({ [CHAT_SCOPE_KEY]: scope, [CHAT_PENDING_KEY]: { requestId, ...pending } });
    return { ok: false, message, chat: history, pending };
  } finally { if (activeRequestId === requestId) activeRequestId = undefined; }
}
/** Reuse only the tab this extension created, never another browser tab. */
export async function openReviewTab(): Promise<ChatResult> {
  const config = await loadConfig();
  let url: string;
  try { url = `${configuredApiOrigin(config.baseUrl)}/dashboard/agents#review-actions`; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Save a valid PointUp URL first." }; }
  await openOwnedReviewTab(url);
  return { ok: true, message: "Review and approve proposed actions in PointUp." };
}
