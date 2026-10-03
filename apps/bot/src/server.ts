import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { handleCommand } from "./commands";
import type { BotUseCases } from "./commands";
import {
  DISCORD_DEFERRED,
  DISCORD_PONG,
  discordMessage,
  editDiscordReply,
  parseDiscordInteraction,
  verifyDiscordSignature,
} from "./discord";
import type { BotEnv } from "./env";
import {
  parseSlackCommand,
  postToSlack,
  resolveUserId,
  verifySlackSignature,
} from "./slack";

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  close?: IncomingMessage,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...(close ? { Connection: "close" } : {}) });
  res.end(payload, () => close?.destroy());
}

export const MAX_BOT_BODY_BYTES = 64 * 1024;
const MAX_BODY_TIMEOUT_MS = 15_000;
interface BodyFailure {
  readonly status: number;
  readonly code: string;
}
const bodyFailures = new WeakMap<object, BodyFailure>();

function bodyFailure(status: number, code: string): Error {
  const failure = new Error("Bot request body rejected");
  bodyFailures.set(failure, { status, code });
  return failure;
}

/** An aborted stream may emit error after aborted; retain only a fixed sink until close. */
function discardUntilClosed(req: IncomingMessage): void {
  if (req.closed) return;
  const discardError = () => undefined;
  req.on("error", discardError);
  req.once("close", () => req.off("error", discardError));
}

/** Count raw bytes before decoding/signature verification; never inspect errors. */
function readBody(req: IncomingMessage, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const length = req.headers["content-length"];
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
    ) {
      req.pause();
      discardUntilClosed(req);
      reject(bodyFailure(400, "invalid body length"));
      return;
    }
    if (length !== undefined && Number(length) > MAX_BOT_BODY_BYTES) {
      req.pause();
      discardUntilClosed(req);
      reject(bodyFailure(413, "request body too large"));
      return;
    }
    let bytes = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
    };
    const fail = (status: number, code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      req.pause();
      discardUntilClosed(req);
      reject(bodyFailure(status, code));
    };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BOT_BODY_BYTES) {
        fail(413, "request body too large");
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      if (length !== undefined && Number(length) !== bytes) {
        fail(400, "incomplete request body");
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, bytes).toString("utf8"));
      chunks.length = 0;
    };
    const onError = () => fail(400, "request body interrupted");
    const onAborted = () => fail(400, "request body interrupted");
    const onClose = () => {
      if (!req.complete) fail(400, "incomplete request body");
    };
    const timer = setTimeout(() => fail(408, "request body timed out"), timeoutMs);
    timer.unref();
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
    req.once("close", onClose);
  });
}

function handleRequestFailure(
  req: IncomingMessage,
  res: ServerResponse,
  error: unknown,
): void {
  // WeakMap lookup does not read arbitrary thrown properties/getters/custom inspect.
  const failure = error !== null && typeof error === "object" ? bodyFailures.get(error) : undefined;
  console.error(failure ? "[bot] request body rejected" : "[bot] request error");
  if (!res.headersSent && !res.destroyed) {
    json(res, failure?.status ?? 500, { error: failure?.code ?? "internal error" }, req);
  } else {
    req.destroy();
  }
}

export function createBotServer(options: {
  readonly env: BotEnv;
  readonly useCases: BotUseCases;
  /** Smaller bound for deterministic HTTP timeout tests; never above production15s. */
  readonly bodyTimeoutMs?: number;
}) {
  const { env, useCases } = options;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? MAX_BODY_TIMEOUT_MS;
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > MAX_BODY_TIMEOUT_MS) {
    throw new Error("Invalid bot body timeout policy");
  }

  async function handleSlack(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!env.SLACK_SIGNING_SECRET) {
      json(res, 503, { error: "Slack integration is not configured" });
      return;
    }

    const rawBody = await readBody(req, bodyTimeoutMs);
    const ok = verifySlackSignature({
      rawBody,
      signature: header(req, "x-slack-signature"),
      timestamp: header(req, "x-slack-request-timestamp"),
      signingSecret: env.SLACK_SIGNING_SECRET,
      nowMs: Date.now(),
    });
    if (!ok) {
      json(res, 401, { error: "invalid signature" });
      return;
    }

    const command = parseSlackCommand(rawBody);
    const userId = resolveUserId(env.BOT_DEFAULT_USER_ID, command.userId);
    const responseUrl = new URLSearchParams(rawBody).get("response_url");

    // Ack within Slack's 3s window, then reply via response_url so slow paths
    // (a real LLM call) don't time out the request.
    if (responseUrl) {
      json(res, 200, { response_type: "ephemeral", text: "On it… 🧮" });
      void handleCommand({ userId, text: command.text }, useCases)
        .then((text) => postToSlack(responseUrl, text))
        .catch(() => {
          console.error("[bot] command failed");
          return postToSlack(
            responseUrl,
            "Something went wrong handling that command.",
          );
        });
      return;
    }

    // No response_url (e.g. manual curl): reply inline.
    try {
      const text = await handleCommand({ userId, text: command.text }, useCases);
      json(res, 200, { response_type: "ephemeral", text });
    } catch {
      console.error("[bot] command failed");
      json(res, 200, {
        response_type: "ephemeral",
        text: "Something went wrong handling that command.",
      });
    }
  }

  async function handleDiscord(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!env.DISCORD_PUBLIC_KEY) {
      json(res, 503, { error: "Discord integration is not configured" });
      return;
    }

    const rawBody = await readBody(req, bodyTimeoutMs);
    const ok = verifyDiscordSignature({
      rawBody,
      signature: header(req, "x-signature-ed25519"),
      timestamp: header(req, "x-signature-timestamp"),
      publicKeyHex: env.DISCORD_PUBLIC_KEY,
    });
    if (!ok) {
      json(res, 401, { error: "invalid signature" });
      return;
    }

    const interaction = parseDiscordInteraction(rawBody);
    if (interaction.type === "ping") {
      json(res, 200, DISCORD_PONG);
      return;
    }
    if (interaction.type !== "command") {
      json(res, 200, discordMessage("Unsupported interaction."));
      return;
    }

    const userId = resolveUserId(env.BOT_DEFAULT_USER_ID, interaction.userId);

    // With an app id we can defer (ack now, edit the reply later) so slow paths
    // (a real LLM call) don't blow Discord's 3s window. Otherwise reply inline.
    if (env.DISCORD_APP_ID) {
      const appId = env.DISCORD_APP_ID;
      json(res, 200, DISCORD_DEFERRED);
      void handleCommand({ userId, text: interaction.commandText }, useCases)
        .then((text) => editDiscordReply(appId, interaction.token, text))
        .catch(() => {
          console.error("[bot] discord command failed");
          return editDiscordReply(
            appId,
            interaction.token,
            "Something went wrong handling that command.",
          );
        });
      return;
    }

    try {
      const text = await handleCommand(
        { userId, text: interaction.commandText },
        useCases,
      );
      json(res, 200, discordMessage(text));
    } catch {
      console.error("[bot] discord command failed");
      json(res, 200, discordMessage("Something went wrong handling that command."));
    }
  }

  function header(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "POST" && req.url === "/slack/commands") {
      void handleSlack(req, res).catch((error: unknown) => {
        handleRequestFailure(req, res, error);
      });
      return;
    }
    if (req.method === "POST" && req.url === "/discord/interactions") {
      void handleDiscord(req, res).catch((error: unknown) => {
        handleRequestFailure(req, res, error);
      });
      return;
    }
    json(res, 404, { error: "not found" });
  });

}
