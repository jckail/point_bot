import { renderChat } from "./chat-view";
import { loadConfig, saveConfig } from "./config";
import type { ReviewedCapture } from "./capture-state";
import { captureFeedback } from "./capture-view";
import type { ChatEntry, ChatResult, ExtensionMessage, RecordResult } from "./messages";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

let selectedCaptureId: string | undefined;
let captureBusy = false;
let settingsBusy = false;
let chatBusy = false;
function updateControls(): void {
  const busy = captureBusy || settingsBusy;
  ($("record") as HTMLButtonElement).disabled = busy || !selectedCaptureId;
  ($("discardCapture") as HTMLButtonElement).disabled = busy || !selectedCaptureId;
  ($("openObservationReview") as HTMLButtonElement).disabled = busy;
  ($("save") as HTMLButtonElement).disabled = busy || chatBusy;
  for (const id of ["baseUrl", "token"]) ($(id) as HTMLInputElement).disabled = busy || chatBusy;
  $("assistant").querySelectorAll("button").forEach(button => { button.disabled = chatBusy || settingsBusy; });
}
async function runCapture(action: () => Promise<void>): Promise<void> {
  if (captureBusy || settingsBusy) return;
  captureBusy = true;
  updateControls();
  try { await action(); }
  catch { $("status").textContent = "Extension worker unavailable. Keep your capture and retry."; }
  finally { captureBusy = false; updateControls(); }
}
async function refreshLatest(): Promise<void> {
  // The background worker answers `getLatest` with the last capture or null.
  const capture: (ReviewedCapture & { retryLocked?: boolean; receipt?: RecordResult }) | null = await chrome.runtime.sendMessage({
    type: "getLatest",
  });
  const box = $("latest");
  selectedCaptureId = capture?.captureId;
  if (capture) {
    box.textContent = `${capture.providerId}: ${capture.points.toLocaleString("en-US")} • ${new Date(capture.observedAt).toLocaleString()}${capture.retryLocked ? " • retry locked" : ""}`;
    if (capture.receipt) $("status").textContent = captureFeedback(capture.receipt);
  } else {
    box.textContent = "Open a provider page to capture a balance.";
  }
  updateControls();
}

async function init(): Promise<void> {
  const config = await loadConfig();
  ($("baseUrl") as HTMLInputElement).value = config.baseUrl;
  ($("token") as HTMLInputElement).value = config.token;

  $("save").addEventListener("click", () => {
    if (settingsBusy || captureBusy || chatBusy) return;
    settingsBusy = true;
    updateControls();
    void (async () => {
      try {
        await saveConfig({ baseUrl: ($("baseUrl") as HTMLInputElement).value.trim(), token: ($("token") as HTMLInputElement).value.trim() });
      } catch {
        $("status").textContent = "Settings could not be saved. Retry before recording or asking.";
        return;
      }
      showChat([]);
      try {
        await chatRequest({ type: "clearChat" });
        $("status").textContent = "Saved. Pending captures still require their original settings to retry.";
      } catch {
        $("status").textContent = "Settings saved. Conversation could not be cleared while the worker is busy; reopen the popup after it finishes.";
      }
    })().finally(() => { settingsBusy = false; updateControls(); });
  });

  $("askForm").addEventListener("submit", event => {
    event.preventDefault();
    void runChat(async () => {
      const question = $("question") as HTMLTextAreaElement;
      const result = await chatRequest({ type: "ask", message: question.value });
      if (result.chat) showChat(result.chat);
      question.value = "";
      $("chatStatus").textContent = "";
    });
  });
  $("clearChat").addEventListener("click", () => {
    void runChat(async () => {
      const result = await chatRequest({ type: "clearChat" });
      showChat(result.chat ?? []);
      $("chatStatus").textContent = result.message;
    });
  });

  $("record").addEventListener("click", () => {
    void runCapture(async () => {
      $("status").textContent = "Recording…";
      const result = await chrome.runtime.sendMessage<ExtensionMessage, RecordResult>({ type: "record", captureId: selectedCaptureId });
      if (!result || typeof result.ok !== "boolean") throw new Error("Worker unavailable");
      await refreshLatest();
      $("status").textContent = captureFeedback(result);
    });
  });

  for (const type of ["discardCapture", "openObservationReview"] as const) {
    $(type).addEventListener("click", () => {
      void runCapture(async () => {
        let message: ExtensionMessage;
        if (type === "discardCapture") {
          if (!selectedCaptureId) return;
          message = { type, captureId: selectedCaptureId };
        } else message = { type };
        const result = await chrome.runtime.sendMessage<ExtensionMessage, RecordResult>(message);
        if (!result || typeof result.ok !== "boolean") throw new Error("Worker unavailable");
        await refreshLatest();
        $("status").textContent = captureFeedback(result);
      });
    });
  }
  updateControls();
  try { await refreshLatest(); }
  catch { $("status").textContent = "Capture unavailable. Reopen the popup to retry."; }
  try { const result = await chatRequest({ type: "getChat" }); showChat(result.chat ?? []); }
  catch { $("chatStatus").textContent = "Conversation unavailable. Reopen the popup to retry."; }
}

async function chatRequest(message: ExtensionMessage): Promise<ChatResult> {
  const result = await chrome.runtime.sendMessage<ExtensionMessage, ChatResult | undefined>(message);
  if (!result || typeof result.ok !== "boolean") throw new Error("Extension worker unavailable. Reopen the popup and retry.");
  if (!result.ok) throw new Error(result.message);
  return result;
}
async function runChat(action: () => Promise<void>): Promise<void> {
  if (chatBusy || settingsBusy) return;
  chatBusy = true;
  $("chatStatus").textContent = "Thinking…";
  updateControls();
  try { await action(); }
  catch (error) { $("chatStatus").textContent = error instanceof Error ? error.message : "Assistant unavailable. Retry your question."; }
  finally {
    chatBusy = false;
    updateControls();
  }
}
function showChat(chat: readonly ChatEntry[]): void {
  renderChat($("chat"), chat, () => { void runChat(async () => {
    const result = await chatRequest({ type: "openReview" }); $("chatStatus").textContent = result.message;
  }); });
}

void init().catch(() => { $("status").textContent = "Extension settings unavailable. Reopen the popup to retry."; });
