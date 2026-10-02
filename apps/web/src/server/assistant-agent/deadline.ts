/** Bound response latency even when a read-only storage adapter cannot cancel its work. */
export async function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // Argument evaluation starts work before this helper runs. Observe any
    // eventual rejection even when cancellation already prevents the race.
    void work.catch(() => {});
    signal.throwIfAborted();
  }
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Assistant deadline or cancellation"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { if (abort) signal.removeEventListener("abort", abort); }
}
