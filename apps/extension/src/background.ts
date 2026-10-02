import { PointUpClient } from "@pointup/api-client";

import {
  loadConfig,
  loadLatestCapture,
  saveLatestCapture,
  loadCaptureState,
  saveCaptureState,
} from "./config";
import { captureIdentity, completeCapture, finishCapture, isReviewedCapture, observationRequest, type ReviewedCapture } from "./capture-state";
import type { ExtensionMessage, RecordResult } from "./messages";
import { recordCapture } from "./record";
import { askAssistant, clearChat, loadChat, openReviewTab, pointUpOrigin } from "./assistant";

let assistantBusy = false;

function client(baseUrl: string, token: string): PointUpClient {
  return new PointUpClient({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 25_000,
  });
}

let captureQueue: Promise<unknown> = Promise.resolve();
function captureAction<T>(action: () => Promise<T>): Promise<T> {
  const result = captureQueue.then(action);
  captureQueue = result.catch(() => undefined);
  return result;
}
async function record(captureId?: string): Promise<RecordResult> {
  let state = await loadCaptureState();
  const capture = state.pending?.capture ?? state.latest;
  if (!capture) return { ok: false, message: "Nothing captured yet — reload a provider page for a fresh reading." };
  if (captureId && capture.captureId !== captureId) return { ok: false, message: "Capture changed. Review the displayed balance before recording." };
  const config = await loadConfig();
  if (!config.baseUrl || !config.token) return { ok: false, message: "Set the API URL and token in the popup first." };
  const identity = await captureIdentity(config.baseUrl, config.token);
  if (state.pending && state.pending.identity !== identity) return { ok: false, message: "API settings changed for this pending capture. Restore the original settings to retry, or check Dashboard > Agents before discarding it." };
  if (config.token.startsWith("pu_") && !state.pending) {
    state = { ...state, pending: { capture, identity, request: observationRequest(capture) } };
    await saveCaptureState(state); // Freeze the identity/time/payload before network IO.
  }
  const result = await recordCapture(client(config.baseUrl, config.token), config.token, capture, state.pending?.request);
  if (state.pending) state = finishCapture(state, capture.captureId, result);
  else if (result.ok) state = completeCapture(state, capture.captureId);
  await saveCaptureState(state);
  await updateBadge(state.pending?.capture ?? state.latest);
  return result;
}
async function openObservationReview(): Promise<RecordResult> {
  const config = await loadConfig();
  const url = `${pointUpOrigin(config.baseUrl)}/dashboard/agents`;
  const stored = await chrome.storage.session.get("assistantReviewTabId");
  let exists = false;
  if (typeof stored.assistantReviewTabId === "number") {
    try { await chrome.tabs.get(stored.assistantReviewTabId); exists = true; } catch { /* Closed. */ }
  }
  if (exists) await chrome.tabs.update(stored.assistantReviewTabId as number, { url, active: true });
  else {
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id !== undefined) await chrome.storage.session.set({ assistantReviewTabId: tab.id });
  }
  return { ok: true, message: "Review observations in PointUp. Only you can confirm or reject them." };
}

async function updateBadge(capture: ReviewedCapture | null): Promise<void> {
  await chrome.action.setBadgeText({ text: capture ? "1" : "" });
  if (capture) {
    await chrome.action.setBadgeBackgroundColor({ color: "#7C5CFF" });
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (["ask", "getChat", "clearChat", "openReview"].includes(message?.type)) {
      if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || sender.tab) return;
      if (assistantBusy) { sendResponse({ ok: false, message: "The assistant is working. Please wait." }); return; }
      assistantBusy = true;
      const action = message.type === "ask" ? askAssistant(message.message)
        : message.type === "clearChat" ? clearChat()
        : message.type === "openReview" ? openReviewTab()
        : loadChat().then(chat => ({ ok: true, message: "", chat }));
      void action.catch(() => ({ ok: false, message: "Extension worker unavailable. Reopen the popup and retry." }))
        .then(sendResponse).finally(() => { assistantBusy = false; });
      return true;
    }
    if (message.type === "capture") {
      if (!isReviewedCapture(message.capture)) return;
      void captureAction(async () => { await saveLatestCapture(message.capture); await updateBadge(await loadLatestCapture()); });
      return;
    }
    if (["getLatest", "record", "discardCapture", "openObservationReview"].includes(message.type)) {
      if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || sender.tab) return;
      const action = captureAction(async () => {
        if (message.type === "getLatest") return loadLatestCapture();
        if (message.type === "record") return record(message.captureId);
        if (message.type === "openObservationReview") return openObservationReview();
        const state = await loadCaptureState();
        const discarded = state.pending?.capture ?? state.latest;
        if (discarded) await saveCaptureState(completeCapture(state, discarded.captureId));
        await updateBadge(await loadLatestCapture());
        return { ok: true, message: "Discarded local review. This does not undo a submission; check PointUp before recording a fresh capture." };
      });
      void action.catch(() => ({ ok: false, message: "Capture action failed. Keep your review and retry." })).then(sendResponse);
      return true;
    }
    return undefined;
  },
);
