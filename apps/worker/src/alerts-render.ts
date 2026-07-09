import type {
  OutboundEmail,
  OutboundNotification,
  PortfolioAlert,
} from "@pointup/core";

function icon(alert: PortfolioAlert): string {
  return alert.severity === "warning" ? "⚠️" : "ℹ️";
}

/** Renders alerts as a compact chat notification (Slack/Discord). */
export function renderAlertsChat(
  alerts: readonly PortfolioAlert[],
): OutboundNotification {
  const header = `*PointBot alerts* — ${alerts.length} item${alerts.length === 1 ? "" : "s"} need attention`;
  const lines = alerts.map((a) => `${icon(a)} ${a.message}`);
  const markdown = [header, ...lines].join("\n");
  const text = markdown.replace(/\*/g, "");
  return { text, markdown };
}

/** Renders alerts as a plain, urgent email. */
export function renderAlertsEmail(
  alerts: readonly PortfolioAlert[],
  to: string,
): OutboundEmail {
  const warnings = alerts.filter((a) => a.severity === "warning").length;
  const subject =
    warnings > 0
      ? `PointBot: ${warnings} point alert${warnings === 1 ? "" : "s"} need attention`
      : `PointBot: ${alerts.length} portfolio update${alerts.length === 1 ? "" : "s"}`;

  const text = [
    "Here's what needs your attention:",
    "",
    ...alerts.map((a) => `- ${icon(a)} ${a.message}`),
  ].join("\n");

  const html = `
  <div style="background:#0b1020;padding:32px;font-family:Inter,system-ui,sans-serif;">
    <h1 style="color:#f4f6ff;font-size:18px;margin:0 0 12px;">PointBot alerts</h1>
    <ul style="color:#f4f6ff;font-size:14px;line-height:1.6;padding-left:18px;margin:0;">
      ${alerts
        .map(
          (a) =>
            `<li style="color:${a.severity === "warning" ? "#ff8a7a" : "#9aa5cb"};">${icon(a)} ${a.message}</li>`,
        )
        .join("")}
    </ul>
  </div>`;

  return { to, subject, text, html };
}
