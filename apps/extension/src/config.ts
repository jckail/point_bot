import type { ExtractedBalance } from "./extraction";

/** User settings, stored in chrome.storage.local. */
export interface ExtensionConfig {
  /** PointUp API base URL, e.g. https://app.example.com */
  readonly baseUrl: string;
  /** Clerk session token (bearer). See docs/multi-surface.md. */
  readonly token: string;
}

export async function loadConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get(["baseUrl", "token"]);
  return {
    baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : "",
    token: typeof stored.token === "string" ? stored.token : "",
  };
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set(config);
}

/** The most recently captured balance (persisted so the popup can show it). */
export async function saveLatestCapture(
  capture: ExtractedBalance | null,
): Promise<void> {
  await chrome.storage.local.set({ latestCapture: capture });
}

export async function loadLatestCapture(): Promise<ExtractedBalance | null> {
  const stored = await chrome.storage.local.get("latestCapture");
  return (stored.latestCapture as ExtractedBalance | null) ?? null;
}
