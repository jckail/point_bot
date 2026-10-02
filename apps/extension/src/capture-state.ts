import type { SubmitObservationRequest } from "@pointup/api-client";
import type { ExtractedBalance } from "./extraction";
import type { RecordResult } from "./messages";

export interface ReviewedCapture extends ExtractedBalance {
  readonly captureId: string;
  readonly observedAt: string;
  readonly sourceMethod: "page_capture";
}
export interface PendingCapture {
  readonly capture: ReviewedCapture;
  readonly identity: string;
  readonly request: SubmitObservationRequest;
  readonly result?: RecordResult;
}
export interface CaptureState {
  readonly latest: ReviewedCapture | null;
  readonly pending: PendingCapture | null;
  readonly completedIds?: readonly string[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isReviewedCapture(value: unknown): value is ReviewedCapture {
  if (!value || typeof value !== "object") return false;
  const capture = value as ReviewedCapture;
  return typeof capture.captureId === "string" && UUID.test(capture.captureId)
    && typeof capture.providerId === "string" && capture.providerId.length > 0
    && Number.isSafeInteger(capture.points) && capture.points >= 0
    && typeof capture.sourceUrl === "string" && capture.sourceUrl.length <= 2048
    && typeof capture.observedAt === "string" && Number.isFinite(Date.parse(capture.observedAt))
    && new Date(capture.observedAt).toISOString() === capture.observedAt && capture.sourceMethod === "page_capture";
}
/** Repeated hydration delivery keeps identity; a changed reading or document starts anew. */
export function pageCandidate(previous: ReviewedCapture | null, reading: ExtractedBalance,
  uuid: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date()): ReviewedCapture {
  if (previous && previous.providerId === reading.providerId && previous.points === reading.points && previous.sourceUrl === reading.sourceUrl) return previous;
  return { ...reading, captureId: uuid(), observedAt: now().toISOString(), sourceMethod: "page_capture" };
}
export function observationRequest(capture: ReviewedCapture): SubmitObservationRequest {
  return { captureId: capture.captureId, observedAt: capture.observedAt, sourceMethod: capture.sourceMethod,
    skillId: `${capture.providerId}.capture-balance`, points: capture.points, sourceUrl: capture.sourceUrl!, agent: "pointup-extension" };
}
export function receiveCapture(state: CaptureState, capture: ReviewedCapture): CaptureState {
  if (state.completedIds?.includes(capture.captureId)) return state;
  // Delivery of the frozen candidate cannot restore a cleared/newer candidate.
  return { ...state, latest: state.pending?.capture.captureId === capture.captureId ? state.latest : capture };
}
export function completeCapture(state: CaptureState, captureId: string): CaptureState {
  return { ...state, latest: state.latest?.captureId === captureId ? null : state.latest,
    pending: state.pending?.capture.captureId === captureId ? null : state.pending,
    completedIds: [...(state.completedIds ?? []).filter(id => id !== captureId), captureId].slice(-16) };
}
export function finishCapture(state: CaptureState, captureId: string, result: RecordResult): CaptureState {
  if (state.pending?.capture.captureId !== captureId) return state;
  if (result.outcome === "recorded" || result.outcome === "unchanged") {
    return completeCapture(state, captureId);
  }
  return { ...state, pending: { ...state.pending, result } };
}
export async function captureIdentity(baseUrl: string, token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${baseUrl}\0${token}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
