import "server-only";

import { selectProviderSyncMode, type ProviderSyncMode } from "@pointup/core";
import { env } from "@/env";

/** Only serializable capabilities leave the server; configuration stays here. */
export function getProviderSyncOptions(providerIds: readonly string[]): {
  modes: Record<string, ProviderSyncMode>;
  bulkLabel: "Sync supported balances" | "Demo sync all" | null;
} {
  const modes = Object.fromEntries(providerIds.map(id => [id, selectProviderSyncMode(env, id)]));
  const values = Object.values(modes);
  const bulkLabel = values.includes("api") ? "Sync supported balances"
    : values.includes("demo") ? "Demo sync all" : null;
  return { modes, bulkLabel };
}
