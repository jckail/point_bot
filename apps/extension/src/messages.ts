import type { ReviewedCapture } from "./capture-state";

/** content script → background: a balance was scraped from a provider page. */
export interface CaptureMessage {
  readonly type: "capture";
  readonly capture: ReviewedCapture;
}

/** popup → background: record the latest capture against the user's account. */
export interface RecordMessage {
  readonly type: "record";
  readonly captureId?: string;
}

/** popup → background: fetch the latest capture to display. */
export interface GetLatestMessage {
  readonly type: "getLatest";
}

export type ExtensionMessage = CaptureMessage | RecordMessage | GetLatestMessage
  | { readonly type: "ask"; readonly message: string }
  | { readonly type: "getChat" | "clearChat" | "openReview" | "discardCapture" | "openObservationReview" };

export interface ActionReview {
  readonly id: string; readonly kind: string; readonly status: string;
  readonly title: string; readonly summary: string; readonly expiresAt: string;
}
export interface ChatEntry {
  readonly role: "user" | "assistant"; readonly content: string;
  readonly requestId?: string; readonly mode?: string; readonly traceId?: string;
  readonly actions?: readonly ActionReview[];
}
export interface ChatResult extends RecordResult { readonly chat?: readonly ChatEntry[]; }

export interface RecordResult {
  readonly ok: boolean;
  readonly message: string;
  readonly outcome?: "recorded" | "unchanged" | "needs_review" | "rejected";
  readonly observationId?: string;
  readonly reviewId?: string | null;
}
