import { loadConfig, saveConfig } from "./config";
import type { ExtractedBalance } from "./extraction";
import type { RecordResult } from "./messages";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

async function refreshLatest(): Promise<void> {
  const capture = (await chrome.runtime.sendMessage({
    type: "getLatest",
  })) as ExtractedBalance | null;
  const box = $("latest");
  const recordBtn = $("record") as HTMLButtonElement;
  if (capture) {
    box.textContent = `${capture.providerId}: ${capture.points.toLocaleString("en-US")}`;
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
    }).then(() => {
      $("status").textContent = "Saved.";
    });
  });

  $("record").addEventListener("click", () => {
    $("status").textContent = "Recording…";
    void chrome.runtime
      .sendMessage({ type: "record" })
      .then((result: RecordResult) => {
        $("status").textContent = result.message;
        return refreshLatest();
      });
  });

  await refreshLatest();
}

void init();
