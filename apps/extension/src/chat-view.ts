import type { ChatEntry } from "./messages";

const renderedChats = new WeakMap<HTMLElement, { signature: string; reviewAction: () => void }>();

export function renderChat(log: HTMLElement, chat: readonly ChatEntry[], reviewAction: () => void): void {
  const signature = JSON.stringify(chat);
  const previous = renderedChats.get(log);
  if (previous?.signature === signature) {
    previous.reviewAction = reviewAction;
    return; // Polling must not recreate or reannounce an unchanged live log.
  }
  const rendered = { signature, reviewAction };
  renderedChats.set(log, rendered);
  log.replaceChildren();
  for (const entry of chat) {
    const item = document.createElement("p");
    item.textContent = `${entry.role === "user" ? "You" : "PointUp"}: ${entry.content}`;
    log.append(item);
    if (entry.role === "assistant" && entry.requestId) {
      const details = document.createElement("small");
      details.textContent = `Support reference: ${entry.requestId}${entry.mode ? ` • ${entry.mode}` : ""}${entry.traceId ? ` • Trace ${entry.traceId}` : ""}`;
      log.append(details);
    }
    for (const action of entry.actions ?? []) {
      const card = document.createElement("div"); card.className = "proposal";
      const title = document.createElement("strong"); title.textContent = `${action.title} • Last returned status: ${action.status}`;
      const summary = document.createElement("p"); summary.textContent = action.summary;
      const expiry = document.createElement("small"); expiry.textContent = `Expires: ${action.expiresAt}`;
      const statusNotice = document.createElement("small"); statusNotice.textContent = "This is a saved snapshot. Check PointUp for the current status before acting.";
      const review = document.createElement("button"); review.textContent = "Review in PointUp";
      review.addEventListener("click", () => rendered.reviewAction());
      card.append(title, summary, expiry, statusNotice, review); log.append(card);
    }
  }
  log.scrollTop = log.scrollHeight;
}
