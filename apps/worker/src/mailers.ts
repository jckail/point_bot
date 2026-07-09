import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import type { Mailer, OutboundEmail } from "@pointup/core";
import { createTransport } from "nodemailer";

import type { WorkerEnv } from "./env";

/** AWS SES adapter; region comes from the standard AWS environment. */
export class SesMailer implements Mailer {
  private readonly client = new SESClient({});

  constructor(private readonly fromAddress: string) {}

  async send(email: OutboundEmail): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: this.fromAddress,
        Destination: { ToAddresses: [email.to] },
        Message: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: email.text, Charset: "UTF-8" },
            ...(email.html
              ? { Html: { Data: email.html, Charset: "UTF-8" } }
              : {}),
          },
        },
      }),
    );
  }
}

/** SMTP adapter - points at Mailpit (OSS) in local development. */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(
    smtpUrl: string,
    private readonly fromAddress: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(email: OutboundEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.fromAddress,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

/** Logs instead of sending; the default when no mailer is configured. */
export class ConsoleMailer implements Mailer {
  async send(email: OutboundEmail): Promise<void> {
    console.info(
      `[console-mailer] to=${email.to} subject="${email.subject}"\n${email.text}`,
    );
  }
}

export function createMailer(env: WorkerEnv): Mailer {
  switch (env.MAILER) {
    case "ses": {
      if (!env.DIGEST_FROM_EMAIL) {
        throw new Error("MAILER=ses requires DIGEST_FROM_EMAIL");
      }
      return new SesMailer(env.DIGEST_FROM_EMAIL);
    }
    case "smtp": {
      if (!env.SMTP_URL || !env.DIGEST_FROM_EMAIL) {
        throw new Error("MAILER=smtp requires SMTP_URL and DIGEST_FROM_EMAIL");
      }
      return new SmtpMailer(env.SMTP_URL, env.DIGEST_FROM_EMAIL);
    }
    case "console":
      return new ConsoleMailer();
  }
}
