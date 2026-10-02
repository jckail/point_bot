import { apiOrigin, isReviewedCapture, type ReviewedCapture } from "./security";
export interface ExtensionConfig { readonly baseUrl: string; readonly token: string; readonly rememberToken?: boolean; }
export async function loadConfig(): Promise<ExtensionConfig> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  // Migrate older versions' unconditionally persisted credentials.
  await chrome.storage.local.remove(["token", "latestCapture"]);
  const stored = await chrome.storage.local.get(["baseUrl", "agentToken"]);
  const session = await chrome.storage.session.get("token");
  const durable = typeof stored.agentToken === "string" && stored.agentToken.startsWith("pu_") ? stored.agentToken : "";
  return { baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : "",
    token: typeof session.token === "string" ? session.token : durable, rememberToken: Boolean(durable) };
}
export async function saveConfig(config: ExtensionConfig): Promise<void> {
  const baseUrl = apiOrigin(config.baseUrl);
  if (config.rememberToken && !config.token.startsWith("pu_")) throw new Error("Only PointUp personal access tokens (pu_) can be remembered. Session tokens remain temporary.");
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.local.set({ baseUrl });
  if (config.rememberToken) await chrome.storage.local.set({ agentToken: config.token });
  else await chrome.storage.local.remove("agentToken");
  await chrome.storage.session.set({ token: config.token });
  await saveLatestCapture(null);
  await chrome.storage.session.remove("assistantChat");
}
export async function saveLatestCapture(capture: ReviewedCapture | null): Promise<void> {
  await chrome.storage.session.remove("pendingObservation");
  await chrome.storage.session.set({ latestCapture: capture });
}
export async function loadLatestCapture(): Promise<ReviewedCapture | null> {
  const stored = await chrome.storage.session.get("latestCapture");
  return isReviewedCapture(stored.latestCapture) ? stored.latestCapture : null;
}
