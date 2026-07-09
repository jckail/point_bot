import { createClerkClient } from "@clerk/backend";
import type { UserDirectory } from "@pointup/core";

import type { WorkerEnv } from "./env";

/** Resolves emails from Clerk, the system of record for identity. */
export class ClerkUserDirectory implements UserDirectory {
  private readonly clerk;

  constructor(secretKey: string) {
    this.clerk = createClerkClient({ secretKey });
  }

  async getEmail(userId: string): Promise<string | null> {
    const user = await this.clerk.users.getUser(userId);
    const primary = user.emailAddresses.find(
      (address) => address.id === user.primaryEmailAddressId,
    );
    return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  }
}

/** Dev fallback: every user resolves to one override address. */
export class StaticUserDirectory implements UserDirectory {
  constructor(private readonly email: string) {}

  async getEmail(): Promise<string> {
    return this.email;
  }
}

/** No directory configured: digests are skipped for every user. */
export class NullUserDirectory implements UserDirectory {
  async getEmail(): Promise<null> {
    return null;
  }
}

export function createUserDirectory(env: WorkerEnv): UserDirectory {
  if (env.CLERK_SECRET_KEY) return new ClerkUserDirectory(env.CLERK_SECRET_KEY);
  if (env.DIGEST_RECIPIENT_OVERRIDE) {
    return new StaticUserDirectory(env.DIGEST_RECIPIENT_OVERRIDE);
  }
  return new NullUserDirectory();
}
