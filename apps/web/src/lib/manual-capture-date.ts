/** Calendar-only manual captures use UTC dates, not the browser's local timezone.
 * Blank means the core clock's current instant; null means invalid or future.
 */
export function manualCaptureDate(value: string, now = new Date()): Date | undefined | null {
  if (value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") || !Number.isFinite(now.getTime())) return null;
  const noon = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(noon.getTime()) || noon.toISOString().slice(0, 10) !== value) return null;
  const today = now.toISOString().slice(0, 10);
  if (value > today) return null;
  return value === today ? new Date(Math.min(noon.getTime(), now.getTime())) : noon;
}
