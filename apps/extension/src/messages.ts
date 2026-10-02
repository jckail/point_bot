import type { ExtractedBalance } from "./extraction";

/** content script → background: a balance was scraped from a provider page. */
export interface CaptureMessage {
  readonly type: "capture";
  readonly capture: ExtractedBalance;
}

/** popup → background: record the latest capture against the user's account. */
export interface RecordMessage {
  readonly type: "record";
}

/** popup → background: fetch the latest capture to display. */
export interface GetLatestMessage {
  readonly type: "getLatest";
}

export type ExtensionMessage = CaptureMessage | RecordMessage | GetLatestMessage
  | { readonly type: "ask"; readonly message: string }
  | { readonly type: "getChat" | "clearChat" | "openReview" };

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
}
