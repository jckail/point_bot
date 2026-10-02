import type { ReviewedCapture } from "./security";
export type ExtensionMessage =
  | { readonly type: "captureActive"; readonly providerId?: string }
  | { readonly type: "openProvider"; readonly providerId: string }
  | { readonly type: "openPointUp" }
  | { readonly type: "manualBalance"; readonly providerId: string; readonly points: number; readonly unit: string }
  | { readonly type: "getChat" }
  | { readonly type: "clearChat" }
  | { readonly type: "ask"; readonly message: string }
  | { readonly type: "getLatest" }
  | { readonly type: "discard" }
  | { readonly type: "getAccounts" }
  | { readonly type: "record"; readonly captureId: string; readonly accountId: string; readonly points: number };
export interface AccountChoice { readonly id: string; readonly label: string; }
export interface RecordResult {
  readonly ok: boolean;
  readonly message: string;
  readonly capture?: ReviewedCapture | null;
  readonly accounts?: readonly AccountChoice[];
  readonly chat?: readonly ChatEntry[];
}

export interface ChatEntry { readonly role: "user" | "assistant"; readonly content: string; readonly requestId?: string; readonly mode?: string; readonly traceId?: string; readonly actions?: readonly ActionReview[]; }

export interface ActionReview { readonly id: string; readonly kind: string; readonly status: string; readonly title: string; readonly summary: string; readonly expiresAt: string; }
