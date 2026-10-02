/** Prevent a list snapshot from undoing a review result or an uncertain outcome. */
export class AssistantActionRequestGate {
  private generation = 0;
  private reviewing = false;

  beginRead(): number | null {
    if (this.reviewing) return null;
    return ++this.generation;
  }

  canApplyRead(generation: number): boolean {
    return !this.reviewing && generation === this.generation;
  }

  beginReview(): boolean {
    if (this.reviewing) return false;
    this.reviewing = true;
    ++this.generation;
    return true;
  }

  finishReview(): void {
    ++this.generation;
    this.reviewing = false;
  }
}
