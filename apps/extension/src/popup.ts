import { renderChat } from "./chat-view";
import { loadConfig, saveConfig } from "./config";
import { canonicalApiOrigin, INVALID_API_URL } from "./api-origin";
import type { ReviewedCapture } from "./capture-state";
import { captureFeedback } from "./capture-view";
import type { ChatEntry, ChatPending, ChatResult, ExtensionMessage, RecordResult } from "./messages";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

let selectedCaptureId: string | undefined;
let captureBusy = false;
let settingsBusy = false;
let chatBusy = false;
let chatGeneration = 0;
let chatPending: ChatPending | undefined;
let chatRefresh: ReturnType<typeof setTimeout> | undefined;
function updateControls(): void {
  const busy = captureBusy || settingsBusy;
  ($("record") as HTMLButtonElement).disabled = busy || !selectedCaptureId;
  ($("discardCapture") as HTMLButtonElement).disabled = busy || !selectedCaptureId;
  ($("openObservationReview") as HTMLButtonElement).disabled = busy;
  const inferenceBusy = chatBusy || chatPending?.status === "in_flight";
  ($("save") as HTMLButtonElement).disabled = busy || inferenceBusy;
  for (const id of ["baseUrl", "token"]) ($(id) as HTMLInputElement).disabled = busy || inferenceBusy;
  ($("question") as HTMLTextAreaElement).disabled = inferenceBusy || settingsBusy;
  $("assistant").querySelectorAll("button").forEach(button => { button.disabled = inferenceBusy || settingsBusy; });
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
  if (!capture?.receipt) {
    const receipt = await chrome.runtime.sendMessage<ExtensionMessage, RecordResult | null>({ type: "getCaptureReceipt" });
    if (receipt?.ok && typeof receipt.message === "string" && [undefined, "recorded", "unchanged"].includes(receipt.outcome)) {
      $("status").textContent = `Last completed capture: ${captureFeedback(receipt)}`;
    }
  }
  updateControls();
}


async function showCaptureResult(result: RecordResult): Promise<void> {
  const feedback = captureFeedback(result);
  // Acknowledged outcomes must survive an unrelated view-refresh failure.
  $("status").textContent = feedback;
  try {
    await refreshLatest();
    $("status").textContent = feedback;
  } catch {
    selectedCaptureId = undefined;
    $("latest").textContent = "Capture view unavailable. Reopen the popup to refresh it.";
    $("status").textContent = `${feedback} Capture view unavailable. Reopen the popup to refresh it.`;
    updateControls();
  }
}

async function init(): Promise<void> {
  const config = await loadConfig();
  ($("baseUrl") as HTMLInputElement).value = config.baseUrl;
  ($("token") as HTMLInputElement).value = config.token;

  $("save").addEventListener("click", () => {
    if (settingsBusy || captureBusy || chatBusy || chatPending?.status === "in_flight") return;
    settingsBusy = true;
    updateControls();
    void (async () => {
      try {
        const baseUrl = canonicalApiOrigin(($("baseUrl") as HTMLInputElement).value.trim());
        await saveConfig({ baseUrl, token: ($("token") as HTMLInputElement).value.trim() });
        ($("baseUrl") as HTMLInputElement).value = baseUrl;
      } catch (error) {
        $("status").textContent = error instanceof Error && error.message === INVALID_API_URL
          ? INVALID_API_URL : "Settings could not be saved. Retry before recording or asking.";
        return;
      }
      chatGeneration++;
      ($("question") as HTMLTextAreaElement).value = "";
      showChat([]);
      applyChatState({ ok: true, message: "", chat: [] });
      try {
        await chatRequest({ type: "clearChat" });
        $("status").textContent = "Saved. Pending captures keep their original identity. If settings changed, check PointUp before discarding and recapturing.";
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

  $("reviewProposals").addEventListener("click", reviewProposals);

  $("record").addEventListener("click", () => {
    void runCapture(async () => {
      if (!selectedCaptureId) return;
      $("status").textContent = "Recording…";
      const result = await chrome.runtime.sendMessage<ExtensionMessage, RecordResult>({ type: "record", captureId: selectedCaptureId });
      if (!result || typeof result.ok !== "boolean") throw new Error("Worker unavailable");
      await showCaptureResult(result);
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
        await showCaptureResult(result);
      });
    });
  }
  updateControls();
  try { await refreshLatest(); }
  catch { $("status").textContent = "Capture unavailable. Reopen the popup to retry."; }
  try { await chatRequest({ type: "getChat" }); }
  catch { $("chatStatus").textContent = "Conversation unavailable. Reopen the popup to retry."; }
}

async function chatRequest(message: ExtensionMessage): Promise<ChatResult> {
  if (message.type === "ask" || message.type === "clearChat") chatGeneration++;
  const generation = chatGeneration;
  let result: ChatResult | undefined;
  try {
    result = await chrome.runtime.sendMessage<ExtensionMessage, ChatResult | undefined>(message);
  } catch (error) {
    if (message.type === "getChat" && generation !== chatGeneration) return { ok: true, message: "" };
    throw error;
  }
  // A read from before Save/Ask/Clear must not restore an obsolete conversation
  // or replace current feedback, including when its transport failed.
  if (message.type === "getChat" && generation !== chatGeneration) return { ok: true, message: "" };
  if (!result || typeof result.ok !== "boolean") throw new Error("Extension worker unavailable. Reopen the popup and retry.");
  if (result.chat || result.pending || message.type === "getChat" || message.type === "clearChat") applyChatState(result);
  if (!result.ok) throw new Error(result.message);
  return result;
}
function applyChatState(result: ChatResult): void {
  if (result.chat) showChat(result.chat);
  const previous = chatPending;
  chatPending = result.pending;
  const question = $("question") as HTMLTextAreaElement;
  if (chatPending) {
    if (!question.value || chatPending.status === "in_flight") question.value = chatPending.question;
    $("chatStatus").textContent = chatPending.message;
  } else if (previous) {
    if (question.value === previous.question) question.value = "";
    $("chatStatus").textContent = "";
  }
  updateControls();
  if (chatRefresh !== undefined) clearTimeout(chatRefresh);
  chatRefresh = undefined;
  if (chatPending?.status === "in_flight") {
    chatRefresh = setTimeout(() => {
      chatRefresh = undefined;
      void chatRequest({ type: "getChat" }).catch(() => {
        $("chatStatus").textContent = "Conversation status unavailable. Reopen the popup to recover your saved question.";
      });
    }, 1000);
  }
}
function showChatStatus(message: string): void {
  const recovery = chatPending?.status === "uncertain" ? chatPending.message : undefined;
  $("chatStatus").textContent = recovery && recovery !== message ? `${recovery} ${message}` : message;
}
async function runChat(action: () => Promise<void>, activityMessage = "Thinking…"): Promise<void> {
  if (chatBusy || settingsBusy || chatPending?.status === "in_flight") return;
  chatBusy = true;
  showChatStatus(activityMessage);
  updateControls();
  try { await action(); }
  catch (error) { showChatStatus(error instanceof Error ? error.message : "Assistant unavailable. Retry your question."); }
  finally {
    chatBusy = false;
    updateControls();
  }
}
function reviewProposals(): void {
  void runChat(async () => {
    const result = await chatRequest({ type: "openReview" });
    showChatStatus(result.message);
  }, "Opening proposed changes…");
}
function showChat(chat: readonly ChatEntry[]): void {
  renderChat($("chat"), chat, reviewProposals);
}

void init().catch(() => { $("status").textContent = "Extension settings unavailable. Reopen the popup to retry."; });
