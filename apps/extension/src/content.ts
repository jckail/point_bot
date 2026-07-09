import { extractBalance } from "./extraction";
import type { CaptureMessage } from "./messages";

/**
 * Runs on known provider pages. Reads the visible page text, extracts the
 * loyalty balance, and hands it to the background worker. No credentials are
 * ever read — only the balance number the page already shows the signed-in user.
 */
function capture(): void {
  const capture = extractBalance({
    url: location.href,
    text: document.body?.innerText ?? "",
  });
  if (!capture) return;

  const message: CaptureMessage = { type: "capture", capture };
  void chrome.runtime.sendMessage(message);
}

// Provider dashboards render balances after hydration; retry a few times.
capture();
let attempts = 0;
const timer = setInterval(() => {
  attempts += 1;
  capture();
  if (attempts >= 5) clearInterval(timer);
}, 2000);
