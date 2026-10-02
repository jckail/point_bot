/** Process-local protection, shared across cookie and PAT requests by owner.
 * This is not a distributed or billing quota: replicas each enforce their own limits.
 */
export class AssistantAdmission {
  private readonly owners = new Map<string, { active: number; admissions: number[] }>();
  private active = 0;
  constructor(private readonly now: () => number = Date.now, private readonly capacity = 2048) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Invalid admission capacity");
  }

  acquire(userId: string): { release: () => void } | { retryAfter: number } {
    const now = this.now();
    // Entries cannot expire while a run holds a lease. Idle windows are bounded
    // to one minute, and no owner retains more than ten admission timestamps.
    for (const [id, owner] of this.owners) {
      owner.admissions = owner.admissions.filter(time => time > now - 60_000);
      if (!owner.active && !owner.admissions.length) this.owners.delete(id);
    }
    let owner = this.owners.get(userId);
    if (owner && owner.admissions.length >= 10) {
      return { retryAfter: Math.max(1, Math.ceil((owner.admissions[0]! + 60_000 - now) / 1000)) };
    }
    if (this.active >= 16 || (owner?.active ?? 0) >= 2) return { retryAfter: 1 };
    if (!owner) {
      if (this.owners.size >= this.capacity) return { retryAfter: 60 };
      owner = { active: 0, admissions: [] };
      this.owners.set(userId, owner);
    }
    owner.admissions.push(now);
    owner.active++;
    this.active++;
    let released = false;
    return { release: () => {
      if (released) return;
      released = true;
      owner.active--;
      this.active--;
    } };
  }
}

export const assistantAdmission = new AssistantAdmission();
