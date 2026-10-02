import { PointUpClient } from "@pointup/api-client";

import {
  loadConfig,
  loadLatestCapture,
  saveLatestCapture,
} from "./config";
import type { ExtractedBalance } from "./extraction";
import type { ExtensionMessage, RecordResult } from "./messages";
import { recordCapture } from "./record";
import { askAssistant, clearChat, loadChat, openReviewTab } from "./assistant";

let assistantBusy = false;

function client(baseUrl: string, token: string): PointUpClient {
  return new PointUpClient({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Record the capture against the user's matching account. */
async function record(capture: ExtractedBalance): Promise<RecordResult> {
  const config = await loadConfig();
  if (!config.baseUrl || !config.token) {
    return { ok: false, message: "Set the API URL and token in the popup first." };
  }
  return recordCapture(client(config.baseUrl, config.token), config.token, capture);
}

async function updateBadge(capture: ExtractedBalance | null): Promise<void> {
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
      void saveLatestCapture(message.capture).then(() =>
        updateBadge(message.capture),
      );
      return; // no async response needed
    }
    if (message.type === "getLatest") {
      void loadLatestCapture().then((capture) => sendResponse(capture));
      return true; // async response
    }
    if (message.type === "record") {
      void loadLatestCapture()
        .then((capture) =>
          capture
            ? record(capture)
            : Promise.resolve({
                ok: false,
                message: "Nothing captured yet — open a provider page.",
              }),
        )
        .then((result) => {
          if (result.ok) void saveLatestCapture(null).then(() => updateBadge(null));
          sendResponse(result);
        });
      return true; // async response
    }
    return undefined;
  },
);
