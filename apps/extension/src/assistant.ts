import { PointUpApiError, PointUpClient } from "@pointup/api-client";
import { loadConfig, type ExtensionConfig } from "./config";
import type { ActionReview, ChatEntry, ChatResult } from "./messages";
import { openOwnedReviewTab } from "./review-tab";

export const CHAT_TIMEOUT_MS = 25_000;
export const CHAT_HISTORY_LIMIT = 16;
const CHAT_BODY_LIMIT_BYTES = 32 * 1024;
const CHAT_KEY = "assistantChat";
const CHAT_SCOPE_KEY = "assistantChatScope";
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
export async function clearChat(): Promise<ChatResult> {
  await chrome.storage.session.remove(CHAT_KEY);
  await chrome.storage.session.remove(CHAT_SCOPE_KEY);
  return { ok: true, message: "Conversation cleared.", chat: [] };
}
export function pointUpOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Use an HTTPS PointUp URL or a local development URL.");
  }
  return url.origin;
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
export async function askAssistant(question: unknown): Promise<ChatResult> {
  if (typeof question !== "string" || !question.trim() || question.length > 4000) {
    return { ok: false, message: "Enter a question between 1 and 4,000 characters." };
  }
  const config = await loadConfig();
  if (!config.baseUrl || !config.token) return { ok: false, message: "Save your PointUp API URL and token first." };
  let baseUrl: string;
  try { baseUrl = pointUpOrigin(config.baseUrl); } catch { return { ok: false, message: "Use an HTTPS PointUp URL or a local development URL." }; }
  const history = await loadChat(config);
  let diagnostics: Pick<ChatEntry, "requestId" | "mode" | "traceId"> = {};
  const api = new PointUpClient({ baseUrl, timeoutMs: CHAT_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${config.token}`, "X-PointUp-Surface": "extension" },
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error", credentials: "omit" });
      diagnostics = { requestId: supportId(response.headers.get("X-PointUp-Request-Id")) ?? supportId(response.headers.get("x-request-id")),
        mode: supportId(response.headers.get("X-PointUp-Assistant-Mode")), traceId: supportId(response.headers.get("X-PointUp-Trace-Id")) };
      return response;
    } });
  try {
    // Send only typed conversation, never balances, source pages, or browser tab data.
    const result = await api.chatWithAssistant(chatRequest(question.trim(), history));
    const current = await loadConfig();
    if (current.baseUrl !== config.baseUrl || current.token !== config.token) return { ok: false, message: "API settings changed. Ask your question again." };
    if (typeof result.reply !== "string" || !result.reply.trim()) return { ok: false, message: "The assistant returned an empty response. Retry your question." };
    const chat: ChatEntry[] = [...history, { role: "user" as const, content: question.trim() },
      { role: "assistant" as const, content: result.reply.slice(0, 4000), ...diagnostics, actions: actionReviews(result.actions) }].slice(-CHAT_HISTORY_LIMIT);
    await chrome.storage.session.set({ [CHAT_KEY]: chat, [CHAT_SCOPE_KEY]: await chatScope(config.baseUrl, config.token) });
    return { ok: true, message: "", chat };
  } catch (error) { return { ok: false, message: assistantFailure(error, diagnostics.requestId), chat: history }; }
}
/** Reuse only the tab this extension created, never another browser tab. */
export async function openReviewTab(): Promise<ChatResult> {
  const config = await loadConfig();
  let url: string;
  try { url = `${pointUpOrigin(config.baseUrl)}/dashboard/agents#review-actions`; }
  catch { return { ok: false, message: "Save a valid PointUp URL first." }; }
  await openOwnedReviewTab(url);
  return { ok: true, message: "Review and approve proposed actions in PointUp." };
}
