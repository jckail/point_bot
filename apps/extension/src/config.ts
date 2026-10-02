import { captureIdentity, isReviewedCapture, observationRequest, receiveCapture, type CaptureState, type ReviewedCapture } from "./capture-state";
import { canonicalApiOrigin } from "./api-origin";

/** User settings, stored in chrome.storage.local. */
export interface ExtensionConfig {
  /** PointUp API base URL, e.g. https://app.example.com */
  readonly baseUrl: string;
  /** PointUp personal access token (`pu_...`, preferred) or Clerk session token. See docs/multi-surface.md. */
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
  await chrome.storage.local.set({ baseUrl: canonicalApiOrigin(config.baseUrl.trim()), token: config.token.trim() });
}

/** Legacy captures lack an original observed time and require a fresh page reading. */
export async function loadCaptureState(): Promise<CaptureState> {
  const stored = await chrome.storage.local.get("captureState");
  const value = stored.captureState as Partial<CaptureState> | undefined;
  const latest = isReviewedCapture(value?.latest) ? value.latest : null;
  const candidate = value?.pending;
  const pending = candidate && isReviewedCapture(candidate.capture) && typeof candidate.identity === "string"
    && /^[a-f0-9]{64}$/.test(candidate.identity)
    && JSON.stringify(candidate.request) === JSON.stringify(observationRequest(candidate.capture)) ? candidate : null;
  const completedIds = Array.isArray(value?.completedIds) ? value.completedIds.filter(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(-16) : [];
  const receipt = value?.lastReceipt;
  const validReference = (value: unknown) => value == null || (typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value));
  const lastReceipt = receipt && typeof receipt.captureId === "string" && /^[0-9a-f-]{36}$/i.test(receipt.captureId) && typeof receipt.identity === "string"
    && /^[a-f0-9]{64}$/.test(receipt.identity) && typeof receipt.observedAt === "string"
    && Number.isFinite(Date.parse(receipt.observedAt))
    && receipt.result?.ok === true && typeof receipt.result.message === "string" && receipt.result.message.length <= 2048
    && validReference(receipt.result.observationId) && validReference(receipt.result.reviewId)
    && [undefined, "recorded", "unchanged"].includes(receipt.result.outcome) ? receipt : undefined;
  return { latest, pending, completedIds, ...(lastReceipt ? { lastReceipt } : {}) };
}
export async function saveCaptureState(state: CaptureState): Promise<void> {
  await chrome.storage.local.set({ captureState: state });
}
export async function saveLatestCapture(capture: ReviewedCapture | null): Promise<void> {
  const state = await loadCaptureState();
  await saveCaptureState(capture ? receiveCapture(state, capture) : { ...state, latest: null });
}
export async function loadLatestCapture(): Promise<(ReviewedCapture & { retryLocked?: boolean; receipt?: import("./messages").RecordResult }) | null> {
  const state = await loadCaptureState();
  return state.pending ? { ...state.pending.capture, retryLocked: true, receipt: state.pending.result } : state.latest;
}
export async function loadCaptureReceipt(): Promise<import("./record-result").RecordResult | null> {
  const [state, config] = await Promise.all([loadCaptureState(), loadConfig()]);
  if (!state.lastReceipt || state.lastReceipt.identity !== await captureIdentity(config.baseUrl, config.token)) return null;
  const current = await loadConfig();
  if (current.baseUrl !== config.baseUrl || current.token !== config.token) return null;
  return state.lastReceipt.result;
}
