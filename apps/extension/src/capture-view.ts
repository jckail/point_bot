import type { RecordResult } from "./record-result";

/** Restore durable recovery feedback as plain text, including receipt references. */
export function captureFeedback(result: RecordResult): string {
  return [result.outcome ? `Outcome: ${result.outcome}.` : "", result.message,
    result.observationId ? `Observation: ${result.observationId}` : "",
    result.reviewId ? `Review: ${result.reviewId}` : ""].filter(Boolean).join(" ");
}
