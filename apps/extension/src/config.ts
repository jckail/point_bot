import { isReviewedCapture, observationRequest, receiveCapture, type CaptureState, type ReviewedCapture } from "./capture-state";

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
  await chrome.storage.local.set(config);
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
  return { latest, pending, completedIds };
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
