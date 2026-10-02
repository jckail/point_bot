import { GUIDED_PROVIDERS, guidedProvider } from "./providers";
import { loadConfig, saveConfig } from "./config";
import type { ChatEntry, ExtensionMessage, RecordResult } from "./messages";
import { apiOrigin, type ReviewedCapture } from "./security";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}
let capture: ReviewedCapture | null = null;
let working = false;
function selectedProvider() { return guidedProvider(($("program") as HTMLSelectElement).value)!; }
function showProgram(): void {
  const provider = selectedProvider();
  $("programNote").textContent = `${provider.currency}. ${provider.note} ${provider.pageReader ? "Page reading is heuristic; always verify the amount." : "No verified page reader: use reviewed manual entry."}`;
  ($("capture") as HTMLButtonElement).disabled = working || !provider.pageReader;
  ($("manual") as HTMLButtonElement).disabled = working || provider.id === "rakuten";
}

function showCapture(value: ReviewedCapture | null): void {
  capture = value;
  $("latest").textContent = value ? `${guidedProvider(value.providerId)?.currency ?? value.providerId} • ${value.sourceMethod === "manual_entry" ? "manual entry" : "page capture"} • ${value.sourceOrigin} • ${new Date(value.capturedAt).toLocaleTimeString()}${value.lockedAccountId ? " • retry locked" : ""}`
    : "Open your provider account page, then click Capture this tab.";
  ($("points") as HTMLInputElement).readOnly = Boolean(value?.lockedAccountId);
  ($("account") as HTMLSelectElement).disabled = Boolean(value?.lockedAccountId);
  ($("points") as HTMLInputElement).value = value ? String(value.points) : "";
  ($("account") as HTMLSelectElement).replaceChildren(new Option("Choose a linked account", ""));
  ($("record") as HTMLButtonElement).disabled = true;
  ($("discard") as HTMLButtonElement).disabled = !value;
}
async function request(message: ExtensionMessage): Promise<RecordResult> {
  const result = await chrome.runtime.sendMessage(message) as RecordResult | undefined;
  if (!result || typeof result.ok !== "boolean") throw new Error("Extension worker unavailable. Reopen the popup and retry.");
  if (!result.ok) throw new Error(result.message);
  return result;
}
async function refresh(): Promise<void> {
  const result = await request({ type: "getLatest" });
  showCapture(result.capture ?? null);
  if (capture) {
    const accounts = await request({ type: "getAccounts" });
    for (const account of accounts.accounts ?? []) ($("account") as HTMLSelectElement).add(new Option(account.label, account.id));
    if (capture.lockedAccountId) ($("account") as HTMLSelectElement).value = capture.lockedAccountId;
    if (accounts.message) $("status").textContent = accounts.message;
  }
}
async function run(action: () => Promise<void>): Promise<void> {
  if (working) return;
  working = true;
  document.querySelectorAll("button").forEach(button => { button.disabled = true; });
  $("status").textContent = "Working…";
  try { await action(); if ($("status").textContent === "Working…") $("status").textContent = "Ready."; }
  catch (error) { $("status").textContent = error instanceof Error ? error.message : "Action failed. Retry."; }
  finally {
    working = false;
    document.querySelectorAll("button").forEach(button => { button.disabled = false; });
    showProgram();
    ($("ask") as HTMLButtonElement).disabled = false;
    ($("clearChat") as HTMLButtonElement).disabled = false;
    ($("save") as HTMLButtonElement).disabled = false;

    ($("discard") as HTMLButtonElement).disabled = !capture;
    ($("record") as HTMLButtonElement).disabled = working || !capture || !($('account') as HTMLSelectElement).value;
  }
}
function showChat(chat: readonly ChatEntry[]): void {
  const log = $("chat"); log.replaceChildren();
  for (const entry of chat) {
    const item = document.createElement("p");
    item.textContent = `${entry.role === "user" ? "You" : "PointUp"}: ${entry.content}`;
    log.append(item);
    if (entry.role === "assistant" && entry.requestId) {
      const details = document.createElement("small");
      details.textContent = `Request ${entry.requestId}${entry.mode ? ` • ${entry.mode}` : ""}${entry.traceId ? ` • Trace ${entry.traceId}` : ""}`;
      log.append(details);
    }
    for (const action of entry.actions ?? []) {
      const card = document.createElement("div"); card.className = "proposal";
      const title = document.createElement("strong"); title.textContent = `${action.title} • ${action.status}`;
      const summary = document.createElement("p"); summary.textContent = action.summary;
      const expiry = document.createElement("small"); expiry.textContent = `Expires ${new Date(action.expiresAt).toLocaleString()}`;
      const review = document.createElement("button"); review.textContent = "Review in PointUp";
      review.addEventListener("click", () => { void run(async () => { $("status").textContent = (await request({ type: "openPointUp" })).message; }); });
      card.append(title, summary, expiry, review); log.append(card);
    }
  }
}
async function init(): Promise<void> {
  const program = $("program") as HTMLSelectElement;
  for (const provider of GUIDED_PROVIDERS) program.add(new Option(provider.label, provider.id));
  program.addEventListener("change", showProgram); showProgram();
  const config = await loadConfig();
  ($("rememberToken") as HTMLInputElement).checked = config.rememberToken ?? false;
  ($("baseUrl") as HTMLInputElement).value = config.baseUrl;
  ($("token") as HTMLInputElement).value = config.token;
  $("save").addEventListener("click", () => {
    // Request the chosen origin directly inside the user gesture.
    let baseUrl: string;
    try { baseUrl = apiOrigin(($("baseUrl") as HTMLInputElement).value.trim()); }
    catch (error) { $("status").textContent = (error as Error).message; return; }
    const grant = chrome.permissions.request({ origins: [`${baseUrl}/*`] });
    void run(async () => {
      if (!await grant) throw new Error("API access declined. Settings were not saved.");
      const previous = await loadConfig();
      await saveConfig({ baseUrl, token: ($("token") as HTMLInputElement).value.trim(), rememberToken: ($("rememberToken") as HTMLInputElement).checked });
      if (previous.baseUrl && previous.baseUrl !== baseUrl) {
        await chrome.permissions.remove({ origins: [`${apiOrigin(previous.baseUrl)}/*`] });
      }
      showCapture(null); showChat([]);
      $("status").textContent = ($("rememberToken") as HTMLInputElement).checked ? "PointUp personal access token remembered on this device. Revoke it in PointUp settings when no longer needed." : "Settings saved. The token lasts only for this browser session.";
    });
  });
  $("openProvider").addEventListener("click", () => { void run(async () => {
    $("status").textContent = (await request({ type: "openProvider", providerId: selectedProvider().id })).message;
  }); });
  $("openPointUp").addEventListener("click", () => { void run(async () => {
    $("status").textContent = (await request({ type: "openPointUp" })).message;
  }); });
  $("forgetToken").addEventListener("click", () => { void run(async () => {
    const previous = await loadConfig(); await saveConfig({ baseUrl: previous.baseUrl, token: "", rememberToken: false });
    ($("token") as HTMLInputElement).value = ""; ($("rememberToken") as HTMLInputElement).checked = false;
    showCapture(null); showChat([]); $("status").textContent = "Token removed from this device. Revoke the token in PointUp settings to disable it everywhere.";
  }); });
  $("manual").addEventListener("click", () => { void run(async () => {
    const raw = ($("manualPoints") as HTMLInputElement).value;
    if (!/^\d+$/.test(raw)) throw new Error("Enter a whole, nonnegative balance from your signed-in program account.");
    const result = await request({ type: "manualBalance", providerId: selectedProvider().id,
      points: Number(raw), unit: ($("manualUnit") as HTMLSelectElement).value });
    await refresh(); $("status").textContent = result.message;
  }); });
  $("capture").addEventListener("click", () => { void run(async () => {
    showCapture(null);
    const result = await request({ type: "captureActive", providerId: selectedProvider().id });
    await refresh();
    $("status").textContent = result.message;
  }); });
  $("discard").addEventListener("click", () => { void run(async () => {
    const result = await request({ type: "discard" }); showCapture(null); $("status").textContent = result.message;
  }); });
  $("account").addEventListener("change", () => {
    ($("record") as HTMLButtonElement).disabled = working || !capture || !($('account') as HTMLSelectElement).value;
  });
  $("record").addEventListener("click", () => { void run(async () => {
    if (!capture) throw new Error("Capture a balance first.");
    const raw = ($("points") as HTMLInputElement).value;
    if (!/^\d+$/.test(raw)) throw new Error("Enter a whole, nonnegative balance.");
    let result: RecordResult;
    try { result = await request({ type: "record", captureId: capture.id,
      accountId: ($("account") as HTMLSelectElement).value, points: Number(raw) }); }
    catch (error) { await refresh(); throw error; }
    showCapture(null); $("status").textContent = result.message;
  }); });
  $("ask").addEventListener("click", () => { void run(async () => {
    const input = $("question") as HTMLTextAreaElement;
    const result = await request({ type: "ask", message: input.value });
    showChat(result.chat ?? []); input.value = "";
    $("status").textContent = "Assistant replied. Advice uses your PointUp portfolio; verify provider terms before booking.";
  }); });
  $("clearChat").addEventListener("click", () => { void run(async () => {
    const result = await request({ type: "clearChat" }); showChat([]); $("status").textContent = result.message;
  }); });
  await run(async () => {
    showChat((await request({ type: "getChat" })).chat ?? []);
    await refresh();
  });
}
void init().catch(error => { $("status").textContent = error instanceof Error ? error.message : "Could not load settings."; });
