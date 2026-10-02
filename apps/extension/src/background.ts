import { PointUpApiError, PointUpClient } from "@pointup/api-client";
import { loadConfig, loadLatestCapture, saveLatestCapture } from "./config";
import { guidedProvider, validateManualBalance } from "./providers";
import { extractBalance } from "./extraction";
import type { ActionReview, ChatEntry, ExtensionMessage, RecordResult } from "./messages";
import { apiOrigin, isPopupSender, providerForUrl } from "./security";

async function client(observe?: (response: Response) => void, assistant = false): Promise<PointUpClient> {
  const config = await loadConfig();
  if (!config.baseUrl || !config.token) throw new Error("Save your API URL and a current session token first.");
  const baseUrl = apiOrigin(config.baseUrl);
  if (!await chrome.permissions.contains({ origins: [`${baseUrl}/*`] })) {
    throw new Error("API access is missing. Save settings to grant access.");
  }
  return new PointUpClient({ baseUrl, headers: { Authorization: `Bearer ${config.token}`, ...(assistant ? { "X-PointUp-Surface": "extension" } : {}) },
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error", credentials: "omit" });
      observe?.(response); return response;
    }, timeoutMs: assistant ? 25000 : 30000 });
}

function failureMessage(error: unknown): string {
  return error instanceof PointUpApiError && [401, 403].includes(error.status)
    ? "Token expired, scope denied, or collection consent missing. Open PointUp settings to check token scopes and account consent, then retry the same review."
    : error instanceof PointUpApiError ? `API request failed (${error.status}). Try again.`
    : error instanceof Error && error.name === "TimeoutError" ? "The request took too long to respond. Try again."
    : error instanceof Error ? error.message : "Action failed. Please retry.";
}

async function loadChat(): Promise<ChatEntry[]> {
  const stored = await chrome.storage.session.get("assistantChat");
  if (!Array.isArray(stored.assistantChat)) return [];
  return stored.assistantChat.filter((entry: unknown): entry is ChatEntry => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as ChatEntry;
    return ["user", "assistant"].includes(e.role) && typeof e.content === "string" && e.content.length > 0 && e.content.length <= 4000;
  }).slice(-16);
}
async function openOwnedTab(url: string): Promise<void> {
  const stored = await chrome.storage.session.get("providerTabId");
  let exists = false;
  if (typeof stored.providerTabId === "number") {
    try { await chrome.tabs.get(stored.providerTabId); exists = true; } catch { /* Own tab was closed. */ }
  }
  if (exists) await chrome.tabs.update(stored.providerTabId as number, { url, active: true });
  else {
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id !== undefined) await chrome.storage.session.set({ providerTabId: tab.id });
  }
}
function actionReviews(value: unknown): ActionReview[] {
  if (!Array.isArray(value)) return [];
  return value.filter((action): action is ActionReview => Boolean(action) && typeof action === "object"
    && ["id", "kind", "status", "title", "summary", "expiresAt"].every(key => typeof action[key] === "string"))
    .slice(0, 20).map(a => ({ id: a.id.slice(0, 128), kind: a.kind.slice(0, 64), status: a.status.slice(0, 64),
      title: a.title.slice(0, 200), summary: a.summary.slice(0, 2000), expiresAt: a.expiresAt.slice(0, 64) }));
}
let busy = false;
async function handle(message: ExtensionMessage): Promise<RecordResult> {
  if (message.type === "openProvider") {
    const provider = guidedProvider(message.providerId);
    if (!provider) throw new Error("Choose a supported program.");
    await openOwnedTab(provider.startUrl);
    return { ok: true, message: `Opened ${provider.label}. Complete sign-in yourself; reopen this popup on the account page.` };
  }
  if (message.type === "openPointUp") {
    const config = await loadConfig();
    if (!config.baseUrl) throw new Error("Save your PointUp API URL first.");
    await openOwnedTab(`${apiOrigin(config.baseUrl)}/dashboard/settings`);
    return { ok: true, message: "Sign in to PointUp to link accounts, grant or revoke collection consent, create or revoke a token, and review proposed actions." };
  }
  if (message.type === "manualBalance") {
    const provider = validateManualBalance(message.providerId, message.points, message.unit);
    const capture = { id: crypto.randomUUID(), providerId: provider.id, points: message.points,
      capturedAt: Date.now(), sourceOrigin: new URL(provider.startUrl).origin, sourceUrl: provider.startUrl, sourceMethod: "manual_entry" as const };
    await saveLatestCapture(capture);
    return { ok: true, message: `Review ${provider.currency} and choose the linked account. Server consent is required.`, capture };
  }
  if (message.type === "getChat") return { ok: true, message: "", chat: await loadChat() };
  if (message.type === "clearChat") {
    await chrome.storage.session.remove("assistantChat");
    return { ok: true, message: "Conversation cleared.", chat: [] };
  }
  if (message.type === "ask") {
    if (typeof message.message !== "string" || !message.message.trim() || message.message.length > 4000) {
      throw new Error("Enter a question between 1 and 4,000 characters.");
    }
    const history = await loadChat();
    const initialConfig = await loadConfig();
    let diagnostics: Pick<ChatEntry, "requestId" | "mode" | "traceId"> = {};
    const api = await client(response => {
      const bounded = (name: string) => {
        const value = response.headers.get(name);
        return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
      };
      diagnostics = { requestId: bounded("X-PointUp-Request-Id"), mode: bounded("X-PointUp-Assistant-Mode"), traceId: bounded("X-PointUp-Trace-Id") };
    }, true);
    // Only user-entered conversation is sent. Captured balances and tab text are excluded.
    let result: Awaited<ReturnType<PointUpClient["chatWithAssistant"]>>;
    try {
      result = await api.chatWithAssistant({ message: message.message.trim(),
        history: history.map(({ role, content }) => ({ role, content })) });
    } catch (error) {
      return { ok: false, message: `${failureMessage(error)}${diagnostics.requestId ? ` Support reference: ${diagnostics.requestId}` : ""}` };
    }
    const currentConfig = await loadConfig();
    if (currentConfig.baseUrl !== initialConfig.baseUrl || currentConfig.token !== initialConfig.token) {
      throw new Error("API settings changed. Ask your question again.");
    }
    if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("The assistant returned an empty response. Retry your question.");
    const chat: ChatEntry[] = [...history, { role: "user" as const, content: message.message.trim() },
      { role: "assistant" as const, content: result.reply.slice(0, 4000), ...diagnostics, actions: actionReviews((result as { actions?: unknown }).actions) }].slice(-16);
    await chrome.storage.session.set({ assistantChat: chat });
    return { ok: true, message: "", chat };
  }
  if (message.type === "getLatest") return { ok: true, message: "", capture: await loadLatestCapture() };
  if (message.type === "discard") {
    await saveLatestCapture(null);
    return { ok: true, message: "Capture discarded.", capture: null };
  }
  if (message.type === "captureActive") {
    // Clear earlier captures even if this attempt fails.
    await saveLatestCapture(null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !providerForUrl(tab.url)) {
      throw new Error("Open a supported provider account page over HTTPS, then capture again.");
    }
    if (message.providerId && providerForUrl(tab.url) !== message.providerId) throw new Error("This tab does not match the chosen program. Open its account page or enter a reviewed balance manually.");
    const provider = guidedProvider(providerForUrl(tab.url)!);
    if (!provider?.pageReader) throw new Error("This program has no tested page reader. Enter the displayed points/miles manually.");
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({
      url: location.href, text: (document.body?.innerText ?? "").slice(0, 200000),
    }) });
    const page = results[0]?.result;
    if (!page || new URL(page.url).origin !== new URL(tab.url).origin) throw new Error("The page changed. Capture again.");
    const balance = extractBalance(page);
    if (!balance) throw new Error("No unambiguous balance found. Open your account dashboard and retry. Promotional and conflicting numbers are ignored.");
    const capture = { ...balance, id: crypto.randomUUID(), sourceOrigin: new URL(page.url).origin, capturedAt: Date.now(), sourceUrl: new URL(page.url).origin, sourceMethod: "page_capture" as const };
    await saveLatestCapture(capture);
    return { ok: true, message: "Review the balance and choose the account before recording.", capture };
  }
  const capture = await loadLatestCapture();
  if (!capture) throw new Error("Capture expired or missing. Capture your account page again.");
  const requestConfig = await loadConfig();
  const api = await client();
  const matches = (await api.listLoyaltyAccounts()).filter(a => a.provider.id === capture.providerId);
  if (message.type === "getAccounts") return { ok: true, message: matches.length ? "" : "Link this provider in PointUp first.",
    accounts: matches.map(a => ({ id: a.id, label: `${a.provider.displayName} • ending ${a.membershipNumber.slice(-4)}` })) };
  if (message.type !== "record") throw new Error("Unknown request.");
  if (message.captureId !== capture.id || !Number.isSafeInteger(message.points) || message.points < 0) {
    throw new Error("Review changed or invalid. Capture again and enter a whole, nonnegative balance.");
  }
  const account = matches.find(a => a.id === message.accountId);
  if (!account) throw new Error("Choose a linked account for this provider.");
  // Recheck after the account lookup: a slow response must not revive an expired review.
  if ((await loadLatestCapture())?.id !== capture.id) throw new Error("Capture changed or expired. Review again.");
  const config = await loadConfig();
  if (config.baseUrl !== requestConfig.baseUrl || config.token !== requestConfig.token) throw new Error("API settings changed. Review the balance again before submitting.");
  if (!config.token.startsWith("pu_")) throw new Error("Collection requires a PointUp personal access token with portfolio:read and observations:write. Open PointUp settings to create one and grant account consent.");
  const observation = { observationId: capture.id, accountId: account.id, providerId: capture.providerId,
    points: message.points, capturedAt: new Date(capture.capturedAt).toISOString(),
    sourceUrl: capture.sourceUrl ?? capture.sourceOrigin, sourceMethod: capture.sourceMethod ?? "manual_entry" as const };
  const stored = await chrome.storage.session.get("pendingObservation");
  if (stored.pendingObservation && JSON.stringify(stored.pendingObservation) !== JSON.stringify(observation)) {
    throw new Error("This submission is locked for an idempotent retry. Keep the same account and amount, or discard and create a new review after checking PointUp.");
  }
  // Freeze the request before IO: a lost response must retry the exact same UUID and payload.
  await chrome.storage.session.set({ pendingObservation: observation, latestCapture: { ...capture, points: message.points, lockedAccountId: account.id } });
  const outcome = await api.submitAgentObservation(observation);
  if (!["accepted", "held", "rejected"].includes(outcome.status)) throw new Error("Unexpected observation response. Keep this review and retry the same submission.");
  if (outcome.status === "rejected") throw new Error("Observation rejected. Open PointUp to check account consent and source details before creating another review.");
  await saveLatestCapture(null);
  return { ok: true, message: outcome.status === "held"
    ? "Observation held for anomaly review. Open PointUp settings to review; the portfolio balance was not changed."
    : `Recorded ${message.points.toLocaleString("en-US")} for ${account.provider.displayName}.`, capture: null };
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (!isPopupSender(sender, chrome.runtime.id, chrome.runtime.getURL("popup.html"))) return;
  if (!message || !["captureActive", "getLatest", "discard", "getAccounts", "record", "getChat", "clearChat", "ask", "openProvider", "openPointUp", "manualBalance"].includes(message.type)) return;
  if (busy) { sendResponse({ ok: false, message: "Another action is running. Please wait." }); return; }
  busy = true;
  void handle(message).catch((error: unknown): RecordResult => ({ ok: false, message: failureMessage(error) }))
    .then(sendResponse).finally(() => { busy = false; });
  return true;
});
