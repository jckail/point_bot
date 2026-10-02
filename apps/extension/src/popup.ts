import { renderChat } from "./chat-view";
import { loadConfig, saveConfig } from "./config";
import type { ReviewedCapture } from "./capture-state";
import type { ChatEntry, ChatResult, ExtensionMessage, RecordResult } from "./messages";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

let selectedCaptureId: string | undefined;
async function refreshLatest(): Promise<void> {
  // The background worker answers `getLatest` with the last capture or null.
  const capture: (ReviewedCapture & { retryLocked?: boolean; receipt?: RecordResult }) | null = await chrome.runtime.sendMessage({
    type: "getLatest",
  });
  const box = $("latest");
  const recordBtn = $("record") as HTMLButtonElement;
  selectedCaptureId = capture?.captureId;
  ($( "discardCapture") as HTMLButtonElement).disabled = !capture;
  if (capture) {
    box.textContent = `${capture.providerId}: ${capture.points.toLocaleString("en-US")} • ${new Date(capture.observedAt).toLocaleTimeString()}${capture.retryLocked ? " • retry locked" : ""}${capture.receipt?.reviewId ? ` • Review ${capture.receipt.reviewId}` : ""}`;
    recordBtn.disabled = false;
  } else {
    box.textContent = "Open a provider page to capture a balance.";
    recordBtn.disabled = true;
  }
}

async function init(): Promise<void> {
  const config = await loadConfig();
  ($("baseUrl") as HTMLInputElement).value = config.baseUrl;
  ($("token") as HTMLInputElement).value = config.token;

  $("save").addEventListener("click", () => {
    void saveConfig({
      baseUrl: ($("baseUrl") as HTMLInputElement).value.trim(),
      token: ($("token") as HTMLInputElement).value.trim(),
    }).then(async () => {
      await chatRequest({ type: "clearChat" });
      showChat([]);
      $("status").textContent = "Saved.";
    });
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
    $("status").textContent = "Recording…";
    void chrome.runtime
      .sendMessage({ type: "record", captureId: selectedCaptureId })
      .then((result: RecordResult) => {
        $("status").textContent = result.message;
        return refreshLatest();
      });
  });

  for (const type of ["discardCapture", "openObservationReview"] as const) {
    $(type).addEventListener("click", () => {
      void chrome.runtime.sendMessage<ExtensionMessage, RecordResult>({ type }).then(async result => {
        $("status").textContent = result.message;
        await refreshLatest();
      }).catch(() => { $("status").textContent = "Extension worker unavailable. Keep your capture and retry."; });
    });
  }
  await refreshLatest();
  try { const result = await chatRequest({ type: "getChat" }); showChat(result.chat ?? []); }
  catch { $("chatStatus").textContent = "Conversation unavailable. Reopen the popup to retry."; }
}

async function chatRequest(message: ExtensionMessage): Promise<ChatResult> {
  const result = await chrome.runtime.sendMessage<ExtensionMessage, ChatResult | undefined>(message);
  if (!result || typeof result.ok !== "boolean") throw new Error("Extension worker unavailable. Reopen the popup and retry.");
  if (!result.ok) throw new Error(result.message);
  return result;
}
let chatBusy = false;
async function runChat(action: () => Promise<void>): Promise<void> {
  if (chatBusy) return;
  chatBusy = true;
  $("chatStatus").textContent = "Thinking…";
  $("assistant").querySelectorAll("button").forEach(button => { button.disabled = true; });
  ($("save") as HTMLButtonElement).disabled = true;
  try { await action(); }
  catch (error) { $("chatStatus").textContent = error instanceof Error ? error.message : "Assistant unavailable. Retry your question."; }
  finally {
    chatBusy = false;
    $("assistant").querySelectorAll("button").forEach(button => { button.disabled = false; });
    ($("save") as HTMLButtonElement).disabled = false;
  }
}
function showChat(chat: readonly ChatEntry[]): void {
  renderChat($("chat"), chat, () => { void runChat(async () => {
    const result = await chatRequest({ type: "openReview" }); $("chatStatus").textContent = result.message;
  }); });
}

void init();
