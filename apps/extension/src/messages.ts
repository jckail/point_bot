import type { ReviewedCapture } from "./capture-state";
import type { RecordResult } from "./record-result";
export type { RecordResult } from "./record-result";

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
  | { readonly type: "discardCapture"; readonly captureId: string }
  | { readonly type: "getChat" | "clearChat" | "openReview" | "openObservationReview" | "getCaptureReceipt" };

export interface ActionReview {
  readonly id: string; readonly kind: string; readonly status: string;
  readonly title: string; readonly summary: string; readonly expiresAt: string;
}
export interface ChatEntry {
  readonly role: "user" | "assistant"; readonly content: string;
  readonly requestId?: string; readonly mode?: string; readonly traceId?: string;
  readonly actions?: readonly ActionReview[];
}
export interface ChatPending {
  readonly question: string;
  readonly status: "in_flight" | "uncertain";
  readonly message: string;
}
export interface ChatResult extends RecordResult {
  readonly chat?: readonly ChatEntry[];
  readonly pending?: ChatPending;
}
