/**
 * Node-only startup validation, loaded from instrumentation.ts. Importing the
 * env module validates configuration and trips the dev-auth production guard.
 * A failure exits non-zero so an unsafe or misconfigured deploy refuses to
 * run instead of limping along and failing per request.
 */
export async function validateStartup(): Promise<void> {
  try {
    await import("./env");
  } catch (error) {
    console.error(
      error instanceof Error ? `FATAL: ${error.message}` : "FATAL: invalid configuration",
    );
    process.exit(1);
  }
}
