import type {
  AwardWatchHit,
  Mailer,
  Notifier,
  OutboundEmail,
  OutboundNotification,
  UserDirectory,
} from "@pointup/core";

import type { WorkerContainer } from "../container";

function hitLine(hit: AwardWatchHit): string {
  return `“${hit.watch.label}”: ${hit.bestRealizedCpp}¢/pt — ${hit.bestDealTitle} (${hit.watch.url})`;
}

export function renderWatchHitsChat(
  hits: readonly AwardWatchHit[],
): OutboundNotification {
  const markdown = [
    `*PointBot award watch* — ${hits.length} page${hits.length === 1 ? "" : "s"} improved:`,
    ...hits.map((h) => `• ${hitLine(h)}`),
  ].join("\n");
  return { text: markdown.replace(/\*/g, ""), markdown };
}

export function renderWatchHitsEmail(
  hits: readonly AwardWatchHit[],
  to: string,
): OutboundEmail {
  const subject = `PointBot: award value improved on ${hits.length} watched page${hits.length === 1 ? "" : "s"}`;
  const text = [
    "Value improved on pages you're watching:",
    "",
    ...hits.map((h) => `- ${hitLine(h)}`),
  ].join("\n");
  return { to, subject, text };
}

/**
 * Scheduled job: re-scrape every award watch and notify owners whose watches
 * hit their threshold with an improved value. Chat delivery is global
 * (workspace webhooks); email goes to each watch owner.
 */
export async function checkWatches(
  container: WorkerContainer,
  directory: UserDirectory,
  mailer: Mailer,
  notifier: Notifier | null,
): Promise<void> {
  const result = await container.useCases.checkAwardWatches.execute();
  console.info(
    `[watch] checked ${result.checked}, failed ${result.failed}, hits ${result.hits.length}`,
  );
  if (result.hits.length === 0) return;

  if (notifier) {
    await notifier
      .notify(renderWatchHitsChat(result.hits))
      .catch((error: unknown) =>
        console.warn("[watch] chat notify failed", error),
      );
  }

  const byUser = new Map<string, AwardWatchHit[]>();
  for (const hit of result.hits) {
    const list = byUser.get(hit.watch.userId) ?? [];
    list.push(hit);
    byUser.set(hit.watch.userId, list);
  }

  for (const [userId, hits] of byUser) {
    const email = await directory.getEmail(userId).catch(() => null);
    if (!email) continue;
    await mailer
      .send(renderWatchHitsEmail(hits, email))
      .catch((error: unknown) =>
        console.warn(`[watch] user=${userId} email failed`, error),
      );
  }
}
