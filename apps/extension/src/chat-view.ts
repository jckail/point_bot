import type { ChatEntry } from "./messages";

export function renderChat(log: HTMLElement, chat: readonly ChatEntry[], reviewAction: () => void): void {
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
      const title = document.createElement("strong"); title.textContent = `${action.title} • ${action.status}`;
      const summary = document.createElement("p"); summary.textContent = action.summary;
      const expiry = document.createElement("small"); expiry.textContent = `Expires: ${action.expiresAt}`;
      const review = document.createElement("button"); review.textContent = "Review in PointUp";
      review.addEventListener("click", reviewAction);
      card.append(title, summary, expiry, review); log.append(card);
    }
  }
  log.scrollTop = log.scrollHeight;
}

