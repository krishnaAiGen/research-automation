import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { smtpCredsFromEnv } from "@/lib/mailer";
import { authEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** What the app needs in order to actually send — surfaced in the UI banner. */
export async function GET() {
  const creds = smtpCredsFromEnv();
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM papers) AS papers,
              (SELECT COUNT(*) FROM recipients) AS recipients`,
    )
    .get() as { papers: number; recipients: number };

  return NextResponse.json({
    openrouter: Boolean((process.env.OPENROUTER_API_KEY || "").trim()),
    smtp: Boolean(creds.address && creds.appPassword),
    smtpAddress: creds.address ? maskEmail(creds.address) : "",
    // Whether a login is required. Never the credentials themselves — this
    // route is reachable without a session so the container healthcheck works.
    auth: authEnabled(),
    dataImported: counts.papers > 0,
    ...counts,
  });
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
