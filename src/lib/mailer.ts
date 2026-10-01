import nodemailer, { type Transporter } from "nodemailer";

export type SmtpCreds = {
  address: string;
  appPassword: string;
  fromName: string;
};

/**
 * Gmail expires long-lived SMTP connections (421 4.7.0 "Connection expired")
 * on both message count and wall clock, and a multi-hour batch always outlives
 * one connection. `maxMessages` recycles proactively; `sendWithRetry` catches
 * whatever still slips through.
 */
const RECYCLE_AFTER = 50;

export class Mailer {
  private transporter: Transporter | null = null;
  constructor(private creds: SmtpCreds) {}

  private connect(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: this.creds.address, pass: this.creds.appPassword },
      pool: true,
      maxConnections: 1,
      maxMessages: RECYCLE_AFTER,
      connectionTimeout: 60_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });
    return this.transporter;
  }

  close() {
    this.transporter?.close();
    this.transporter = null;
  }

  async verify(): Promise<void> {
    await this.connect().verify();
  }

  async send(
    to: string[],
    subject: string,
    body: string,
    html?: string,
    attachments?: { filename: string; content: Buffer; cid: string }[],
  ): Promise<void> {
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.connect().sendMail({
          from: this.creds.fromName
            ? { name: this.creds.fromName, address: this.creds.address }
            : this.creds.address,
          to: to.join(", "),
          subject,
          text: body,
          // The HTML part is where tracking lives (pixel + rewritten links);
          // clients that render it get the richer view, text-only clients
          // silently fall back to `text` with no tracking at all.
          ...(html ? { html } : {}),
          // Embedded by Content-ID, not linked: the image renders without the
          // recipient granting remote-image permission, and needs nothing of
          // ours to be reachable from their network.
          ...(attachments?.length ? { attachments } : {}),
        });
        return;
      } catch (err) {
        const last = attempt === attempts - 1;
        if (last || !isTransient(err)) throw err;
        // The server rejected the message outright, so nothing was delivered —
        // reconnecting and retrying cannot double-send here.
        this.close();
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
}

/**
 * True only for connection-level failures worth reconnecting on. A permanent
 * rejection (bad address, 5xx) must fail fast and be counted, not burn three
 * reconnects.
 */
function isTransient(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (!e) return false;
  if (e.responseCode && [421, 451, 454].includes(e.responseCode)) return true;
  if (e.responseCode && e.responseCode >= 500) return false;
  return ["ECONNRESET", "ETIMEDOUT", "ECONNECTION", "ESOCKET", "EPIPE"].includes(e.code ?? "");
}

export function smtpCredsFromEnv(): SmtpCreds {
  return {
    address: (process.env.GMAIL_ADDRESS || "").trim(),
    appPassword: (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, ""),
    fromName: (process.env.GMAIL_FROM_NAME || "").trim(),
  };
}
