/**
 * Runs once when the Next.js server boots (including the standalone server,
 * which never loads next.config.ts). The Node-only validation and telemetry
 * live in their own module so the Edge bundle never sees `process.exit` or
 * the OpenTelemetry SDK.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateStartup, startTelemetry } = await import("./instrumentation-node");
  await validateStartup();
  await startTelemetry();
}
