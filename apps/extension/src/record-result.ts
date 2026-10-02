/** Shared observation feedback, independent of capture state and messaging. */
export interface RecordResult {
  readonly ok: boolean;
  readonly message: string;
  readonly outcome?: "recorded" | "unchanged" | "needs_review" | "rejected";
  readonly observationId?: string;
  readonly reviewId?: string | null;
}
