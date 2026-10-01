/**
 * Dev-auth safety rules shared by every host that can run in "dev" auth mode
 * (the web app and the bootstrap job). Pure functions over plain values so
 * they are trivially testable and the core stays free of environment access.
 *
 * Dev auth means: no sign-in, every browser/session request is the one fixed
 * dev user. That is a deliberate local-development convenience and must never
 * be reachable from the public internet.
 */

export const AUTH_PROVIDERS = ["dev", "clerk"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const DEFAULT_DEV_USER_ID = "dev-user";
export const DEFAULT_DEV_ALLOWED_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "::1",
];

export class InsecureDevAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureDevAuthError";
  }
}

/** Unset/empty selects Clerk (the production default); anything else must be exact. */
export function parseAuthProvider(raw: string | undefined | null): AuthProvider {
  const value = raw?.trim().toLowerCase();
  if (!value) return "clerk";
  if ((AUTH_PROVIDERS as readonly string[]).includes(value)) {
    return value as AuthProvider;
  }
  throw new InsecureDevAuthError(
    `AUTH_PROVIDER must be one of ${AUTH_PROVIDERS.join(", ")} (got "${raw}")`,
  );
}

const LOOPBACK_BINDS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** True only for an explicit loopback bind address. Unset/0.0.0.0/:: are public. */
export function isLoopbackBind(hostname: string | undefined | null): boolean {
  return !!hostname && LOOPBACK_BINDS.has(hostname.trim().toLowerCase());
}

export interface DevAuthGuardInput {
  readonly provider: AuthProvider;
  readonly nodeEnv: string | undefined;
  /** ALLOW_INSECURE_DEV_AUTH - must be exactly "true". */
  readonly allowInsecureDevAuth: string | undefined;
  /** Address the process binds to (HOSTNAME / HOST). Unset means all interfaces. */
  readonly bindHost: string | undefined;
  /**
   * DEV_AUTH_HOST_IS_LOOPBACK_ONLY - operator attestation for containers,
   * where the process must bind 0.0.0.0 inside the container but the runtime
   * only publishes the port on 127.0.0.1 (docker-compose does this).
   */
  readonly loopbackOnlyAttested: string | undefined;
}

/**
 * Throws (so the process refuses to boot) when dev auth is combined with a
 * production NODE_ENV without BOTH an explicit opt-in and a non-public bind.
 * Outside production, dev auth is always allowed.
 */
export function assertDevAuthAllowed(input: DevAuthGuardInput): void {
  if (input.provider !== "dev") return;
  if (input.nodeEnv !== "production") return;

  if (input.allowInsecureDevAuth !== "true") {
    throw new InsecureDevAuthError(
      "Refusing to start: AUTH_PROVIDER=dev disables sign-in and NODE_ENV=production. " +
        "Use AUTH_PROVIDER=clerk, or for a local-only container stack set " +
        "ALLOW_INSECURE_DEV_AUTH=true (never on a publicly reachable host).",
    );
  }
  if (
    !isLoopbackBind(input.bindHost) &&
    input.loopbackOnlyAttested !== "true"
  ) {
    throw new InsecureDevAuthError(
      "Refusing to start: AUTH_PROVIDER=dev with ALLOW_INSECURE_DEV_AUTH=true requires a " +
        "non-public bind. Bind to 127.0.0.1 (HOSTNAME=127.0.0.1), or inside a container " +
        "publish the port on 127.0.0.1 only and set DEV_AUTH_HOST_IS_LOOPBACK_ONLY=true.",
    );
  }
}

/** Hostname of a Host header value: lowercased, port and IPv6 brackets stripped. */
export function hostnameOf(hostHeader: string): string {
  const v = hostHeader.trim().toLowerCase();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end === -1 ? v : v.slice(1, end);
  }
  return v.split(":").length - 1 === 1 ? v.slice(0, v.indexOf(":")) : v;
}

/**
 * Request-level defence in depth: the dev session only exists for loopback
 * (or explicitly allow-listed) Host headers, so a dev-mode server that ends up
 * behind a public hostname still has no free session.
 */
export function isDevHostAllowed(
  hostHeader: string | null | undefined,
  allowedHosts: readonly string[] = DEFAULT_DEV_ALLOWED_HOSTS,
): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader);
  return allowedHosts.some((h) => hostnameOf(h) === name);
}

/** Dev tokens must look like real ones and be long enough not to be guessed trivially. */
export const MIN_DEV_TOKEN_LENGTH = 32;

export function assertValidDevToken(token: string): void {
  if (!token.startsWith("pu_") || token.length < MIN_DEV_TOKEN_LENGTH) {
    throw new InsecureDevAuthError(
      `POINTUP_DEV_TOKEN must start with "pu_" and be at least ${MIN_DEV_TOKEN_LENGTH} characters`,
    );
  }
}
