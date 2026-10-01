/**
 * Runs once when the Next.js server boots (including the standalone server,
 * which never loads next.config.ts). Importing the env module here validates
 * configuration and trips the dev-auth production guard at startup. A failure
 * exits the process (non-zero) so an unsafe or misconfigured deploy refuses to
 * run instead of limping along and failing per request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    await import("./env");
  } catch (error) {
    console.error(
      error instanceof Error ? `FATAL: ${error.message}` : "FATAL: invalid configuration",
    );
    process.exit(1);
  }
}
