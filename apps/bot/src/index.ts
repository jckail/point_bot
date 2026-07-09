import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { handleCommand } from "./commands";
import { createContainer } from "./container";
import {
  DISCORD_DEFERRED,
  DISCORD_PONG,
  discordMessage,
  editDiscordReply,
  parseDiscordInteraction,
  verifyDiscordSignature,
} from "./discord";
import { loadEnv } from "./env";
import {
  parseSlackCommand,
  resolveUserId,
  verifySlackSignature,
} from "./slack";

const env = loadEnv();
const useCases = createContainer(env);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

/** Post the final command result to Slack's response_url (deferred reply). */
async function postToSlack(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => {
    console.warn("[bot] failed to post deferred Slack reply", error);
  });
}

async function handleSlack(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!env.SLACK_SIGNING_SECRET) {
    json(res, 503, { error: "Slack integration is not configured" });
    return;
  }

  const rawBody = await readBody(req);
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
      .catch((error: unknown) => {
        console.error("[bot] command failed", error);
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
  } catch (error) {
    console.error("[bot] command failed", error);
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

  const rawBody = await readBody(req);
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
      .catch((error: unknown) => {
        console.error("[bot] discord command failed", error);
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
  } catch (error) {
    console.error("[bot] discord command failed", error);
    json(res, 200, discordMessage("Something went wrong handling that command."));
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "POST" && req.url === "/slack/commands") {
    void handleSlack(req, res).catch((error: unknown) => {
      console.error("[bot] request error", error);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/discord/interactions") {
    void handleDiscord(req, res).catch((error: unknown) => {
      console.error("[bot] request error", error);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    });
    return;
  }
  json(res, 404, { error: "not found" });
});

server.listen(env.PORT, () => {
  console.info(`[bot] listening on :${env.PORT}`);
});
