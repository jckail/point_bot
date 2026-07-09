import { createPublicKey, verify } from "node:crypto";

/**
 * Verify a Discord interaction request (Ed25519).
 * https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint
 *
 * signature (hex) signs `timestamp + rawBody` with the app's Ed25519 public
 * key (hex, 32 bytes). We wrap the 32-byte raw key in the fixed Ed25519 SPKI
 * DER prefix so Node's `crypto.verify` accepts it.
 */
export function verifyDiscordSignature(params: {
  readonly rawBody: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly publicKeyHex: string;
}): boolean {
  const { rawBody, signature, timestamp, publicKeyHex } = params;
  if (!signature || !timestamp) return false;
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyHex, "hex"),
    ]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export type DiscordInteraction =
  | { readonly type: "ping" }
  | {
      readonly type: "command";
      readonly commandText: string;
      readonly userId: string;
      readonly token: string;
    }
  | { readonly type: "unsupported" };

const PING = 1;
const APPLICATION_COMMAND = 2;

interface DiscordOption {
  readonly value?: unknown;
}
interface DiscordBody {
  readonly type?: number;
  readonly token?: string;
  readonly data?: { readonly name?: string; readonly options?: DiscordOption[] };
  readonly member?: { readonly user?: { readonly id?: string } };
  readonly user?: { readonly id?: string };
}

/**
 * Parse a Discord interaction. Command text is taken from the first string
 * option (so a single `/pointbot query:<text>` command works), falling back to
 * the command name (so per-action commands like `/portfolio` also work).
 */
export function parseDiscordInteraction(rawBody: string): DiscordInteraction {
  const body = JSON.parse(rawBody) as DiscordBody;
  if (body.type === PING) return { type: "ping" };
  if (body.type === APPLICATION_COMMAND) {
    const userId = body.member?.user?.id ?? body.user?.id ?? "";
    const options = body.data?.options ?? [];
    const firstString = options.find((o) => typeof o.value === "string")?.value;
    const commandText = String(firstString ?? body.data?.name ?? "");
    return { type: "command", commandText, userId, token: body.token ?? "" };
  }
  return { type: "unsupported" };
}

// Interaction response payloads.
export const DISCORD_PONG = { type: 1 } as const;
/** Ephemeral message (flags: 64 = EPHEMERAL). */
export function discordMessage(content: string) {
  return { type: 4, data: { content: content.slice(0, 2000), flags: 64 } };
}
export const DISCORD_DEFERRED = { type: 5, data: { flags: 64 } } as const;

/** Edit the original deferred reply with the final content. */
export async function editDiscordReply(
  appId: string,
  token: string,
  content: string,
): Promise<void> {
  await fetch(
    `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch((error: unknown) => {
    console.warn("[bot] failed to edit deferred Discord reply", error);
  });
}
