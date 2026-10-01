/**
 * Runs once when the Next.js server boots (including the standalone server,
 * which never loads next.config.ts). The Node-only validation lives in its own
 * module so the Edge bundle never sees `process.exit`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateStartup } = await import("./instrumentation-node");
  await validateStartup();
}
