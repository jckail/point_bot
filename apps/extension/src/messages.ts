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

export type ExtensionMessage = CaptureMessage | RecordMessage | GetLatestMessage;

export interface RecordResult {
  readonly ok: boolean;
  readonly message: string;
}
