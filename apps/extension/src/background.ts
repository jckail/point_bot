import { PointUpClient } from "@pointup/api-client";

import {
  loadConfig,
  loadLatestCapture,
  saveLatestCapture,
} from "./config";
import type { ExtractedBalance } from "./extraction";
import type { ExtensionMessage, RecordResult } from "./messages";
import { recordCapture } from "./record";

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
  (message: ExtensionMessage, _sender, sendResponse) => {
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
